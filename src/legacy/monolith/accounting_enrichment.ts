import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createWorker, Worker } from 'tesseract.js';
import axios from 'axios';
import { GoogleDriveService } from '../drive/googleDriveService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

const execFileAsync = promisify(execFile);

const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const ARCHIVE_FOLDER_ID = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';

const PRIVATE_KEYWORDS = [
  'flink',
  'getränke hoffmann',
  'getraenke hoffmann',
  'lidl',
  'rewe',
  'edeka',
  'wolt',
  'lieferando',
  'woolworth',
  'netflix',
  'apotheke',
  'apotheken'
];

const ARCHIVE_KEYWORDS = [
  'finanzamt',
  'aok',
  'sbk',
  'arag',
  'eplus',
  'ds_store',
  'handykarte',
  'mitteilung',
  'bescheid',
  'übertragungsprotokoll',
  'uebertragungsprotokoll'
];

const INVOICE_KEYWORDS = [
  'rechnung',
  'invoice',
  'quittung',
  'beleg'
];

const FUEL_KEYWORDS = ['kraftstoff', 'benzin', 'diesel', 'super e10', 'tankstelle'];
const PRIVATE_MIXED_KEYWORDS = ['zigarette', 'bier', 'alkohol', 'tabak'];

type BelegArt = 'Einnahme' | 'Ausgabe' | 'Unklar';

interface ParsedDoc {
  belegart: BelegArt;
  lieferant: string;
  kunde: string;
  belegnr: string;
  belegId: string;
  belegdatum: string;
  leistungsdatum: string;
  steuerkategorie: string;
  mwst19: number;
  mwst7: number;
  mwst0: number;
  nettoGesamt: number;
  bruttoGesamt: number;
  geschaeftlicheMwst: number;
  privateMwst: number;
  geschaeftlicherAnteilBrutto: number;
  privaterAnteilBrutto: number;
  sollkonto: string;
  habenkonto: string;
  iban: string;
  bic: string;
  bankleitzahl: string;
  hinweis: string;
  duplicateGroup: string;
  status: string;
  lineItemsJson: string;
}

interface BelegeRow {
  rowNumber: number;
  id: string;
  driveFileId: string;
  originalName: string;
  mimeType: string;
  sourceFolderId: string;
  targetFolderId: string;
  fileUrl: string;
  extractedText: string;
  ocrText: string;
  metadata: string;
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const limited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!limited || attempt === maxAttempts) throw error;
      const wait = attempt * 2500;
      console.warn(`${op}: rate limited, retry ${attempt}/${maxAttempts} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`${op}: exhausted`);
}

function parseAmount(raw: string): number {
  const clean = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(raw: string): string {
  const dmy = raw.match(/\b([0-3]?\d)[.\-/]([01]?\d)[.\-/](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = raw.match(/\b(20\d{2})[.\-/]([01]?\d)[.\-/]([0-3]?\d)\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return '';
}

function clampText(input: string, max = 50000): string {
  if (input.length <= max) return input;
  return input.slice(0, max);
}

function shouldUseQwenFallback(text: string, minLength: number): boolean {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (normalized.length < minLength) return true;

  const alphaCount = (normalized.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  const digitCount = (normalized.match(/\d/g) || []).length;
  const suspiciousCount = (normalized.match(/[^\w\sÄÖÜäöüß€.,;:!?%()\/+\-]/g) || []).length;
  const tokens = normalized.split(' ').filter(Boolean);
  const longTokens = tokens.filter((t) => t.length >= 3).length;

  const alphaRatio = alphaCount / Math.max(1, normalized.length);
  const suspiciousRatio = suspiciousCount / Math.max(1, normalized.length);

  const hasDate = /\b([0-3]?\d[.\-/][01]?\d[.\-/](?:19|20)\d{2}|(?:19|20)\d{2}[.\-/][01]?\d[.\-/][0-3]?\d)\b/.test(normalized);
  const hasAmount = /\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\b/.test(normalized);
  const hasInvoiceSignals = /\b(rechnung|invoice|beleg|quittung|mwst|ust|netto|brutto|gesamt|summe|zahlbetrag|eur)\b/i.test(normalized);

  if (suspiciousRatio > 0.18) return true;
  if (alphaRatio < 0.2 && digitCount < 8) return true;
  if (longTokens < 3 && normalized.length < 350) return true;
  if (!hasInvoiceSignals && !hasDate && !hasAmount && tokens.length < 15) return true;

  return false;
}

function detectBinaryKind(filePath: string): 'pdf' | 'image' | 'other' {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const head = buffer.toString('latin1');
    if (head.startsWith('%PDF-')) return 'pdf';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image'; // JPEG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image'; // PNG
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image'; // GIF
    if (head.startsWith('BM')) return 'image'; // BMP
    if (head.startsWith('RIFF') && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image'; // WEBP
    return 'other';
  } catch {
    return 'other';
  }
}

function getExtractionStatusFromMetadata(metadata: string): string {
  if (!metadata) return '';
  try {
    const parsed = JSON.parse(metadata);
    const status = parsed?.extraction_status ?? parsed?.extractionStatus ?? '';
    return String(status || '');
  } catch {
    return '';
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  const pdfBuffer = fs.readFileSync(filePath);
  const pdfData = new Uint8Array(pdfBuffer);
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
  let fullText = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

async function renderFirstPdfPageToPng(filePath: string, targetPathNoExt: string): Promise<string> {
  await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', filePath, targetPathNoExt]);
  return `${targetPathNoExt}.png`;
}

async function ensureWorker(worker: Worker | null): Promise<Worker> {
  if (worker) return worker;
  return await createWorker('deu+eng');
}

async function ocrWithTesseract(worker: Worker, imagePath: string): Promise<string> {
  const result = await worker.recognize(imagePath);
  return (result.data.text || '').trim();
}

function detectImageMimeByPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/png';
}

async function maybePrepareImageForQwen(imagePath: string): Promise<{ path: string; cleanup: boolean }> {
  const maxBytes = Number.parseInt(process.env.NVIDIA_QWEN_MAX_IMAGE_BYTES || '3000000', 10);
  const maxDim = Number.parseInt(process.env.NVIDIA_QWEN_MAX_IMAGE_DIM || '1800', 10);
  try {
    const stats = fs.statSync(imagePath);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || stats.size <= maxBytes) {
      return { path: imagePath, cleanup: false };
    }
    const outPath = path.join(
      path.dirname(imagePath),
      `${path.basename(imagePath, path.extname(imagePath))}_qwen.jpg`
    );
    await execFileAsync('sips', ['-Z', String(Number.isFinite(maxDim) && maxDim > 0 ? maxDim : 1800), '-s', 'format', 'jpeg', imagePath, '--out', outPath]);
    if (fs.existsSync(outPath)) {
      return { path: outPath, cleanup: true };
    }
  } catch {
    // If resizing is not available, send original image.
  }
  return { path: imagePath, cleanup: false };
}

function extractMessageContent(raw: any): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  if (typeof raw.text === 'string') return raw.text.trim();
  return '';
}

async function ocrWithQwenFallback(imagePath: string): Promise<string> {
  const apiKey = (process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) return '';
  if (!fs.existsSync(imagePath)) return '';

  const model = (process.env.NVIDIA_QWEN_MODEL || 'qwen/qwen3.5-397b-a17b').trim();
  const maxTokens = Number.parseInt(process.env.NVIDIA_QWEN_MAX_TOKENS || '4096', 10);
  const timeoutMs = Number.parseInt(process.env.NVIDIA_QWEN_TIMEOUT_MS || '180000', 10);

  const prepared = await maybePrepareImageForQwen(imagePath);
  try {
    const buffer = fs.readFileSync(prepared.path);
    const mime = detectImageMimeByPath(prepared.path);
    const b64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    const payload = {
      model,
      stream: false,
      temperature: 0,
      top_p: 0.95,
      max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        {
          role: 'system',
          content: 'Du bist OCR-Extraktor. Gib nur den extrahierten Volltext zurueck. Keine Erklaerungen.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrahiere den gesamten Text aus diesem Beleg/Scan. Gib ausschliesslich den Text zurueck.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    };

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000
    });

    const text = extractMessageContent(response.data?.choices?.[0]?.message?.content);
    return (text || '').trim();
  } finally {
    if (prepared.cleanup && fs.existsSync(prepared.path)) {
      fs.unlinkSync(prepared.path);
    }
  }
}

function detectSupplier(text: string, fallbackName: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .slice(0, 20);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('rechnung') || lower.includes('invoice')) continue;
    if (/\d{5}/.test(line) && line.length < 40) continue;
    if (/^[A-Z0-9 .,&\-]{3,}$/.test(line) || /[A-Za-zÄÖÜäöüß]{3,}/.test(line)) {
      return line.slice(0, 120);
    }
  }
  return fallbackName;
}

function detectInvoiceNo(text: string): string {
  const patterns = [
    /(?:rechnungs(?:nummer|nr\.?|#)|invoice(?:\s*no\.?|\s*number)?|beleg(?:nr\.?|nummer)?)\s*[:#]?\s*([A-Z0-9\-\/\.]{4,})/i,
    /\b([A-Z]{1,4}-\d{3,})\b/,
    /\b(\d{6,})\b/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1].slice(0, 80);
  }
  return '';
}

function detectIban(text: string): string {
  const m = text.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/i);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function detectBic(text: string): string {
  const m = text.match(/\b([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/);
  return m ? m[1] : '';
}

function detectCustomer(text: string): string {
  const m = text.match(/(?:kunde|customer|an)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .,&-]{3,80})/i);
  return m ? m[1].trim() : '';
}

function extractVatAmount(text: string, rate: '19' | '7' | '0'): number {
  const m = text.match(new RegExp(`(?:mwst|ust|umsatzsteuer|mehrwertsteuer)[^\\n\\r]{0,40}${rate}\\s*%[^\\d]{0,10}([\\d.,]{1,20})`, 'i'));
  return m ? parseAmount(m[1]) : 0;
}

function extractGross(text: string): number {
  const patterns = [
    /(?:gesamt(?:betrag)?|summe|zahlbetrag|brutto)[^\d]{0,20}([\d.,]{1,20})/i,
    /(?:total)[^\d]{0,20}([\d.,]{1,20})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseAmount(m[1]);
  }
  return 0;
}

function extractNet(text: string): number {
  const m = text.match(/(?:netto(?:betrag)?|net amount)[^\d]{0,20}([\d.,]{1,20})/i);
  return m ? parseAmount(m[1]) : 0;
}

function classifySteuerkategorie(text: string): string {
  const lower = text.toLowerCase();
  if (FUEL_KEYWORDS.some((k) => lower.includes(k))) return 'Kraftstoff/Benzin';
  if (lower.includes('bewirt') || lower.includes('restaurant') || lower.includes('lieferando') || lower.includes('wolt')) return 'Bewirtung';
  if (lower.includes('strom') || lower.includes('vattenfall') || lower.includes('energie')) return 'Strom/Energie';
  if (lower.includes('ionos') || lower.includes('1&1') || lower.includes('hosting') || lower.includes('domain')) return 'IT/Hosting';
  if (lower.includes('miete')) return 'Miete';
  if (lower.includes('versicherung') || lower.includes('hdi')) return 'Versicherung';
  return 'Sonstiges';
}

function detectBelegart(text: string, supplier: string, customer: string): BelegArt {
  const lower = `${text}\n${supplier}\n${customer}`.toLowerCase();
  const ownIssuer = lower.includes('zoe') || lower.includes('jeremy schulze');
  if (ownIssuer && lower.includes('rechnung')) return 'Einnahme';
  if (lower.includes('gutschrift') && ownIssuer) return 'Einnahme';
  if (INVOICE_KEYWORDS.some((k) => lower.includes(k))) return 'Ausgabe';
  return 'Unklar';
}

function computePrivateSplit(text: string, brutto: number, mwst19: number, mwst7: number): {
  businessGross: number;
  privateGross: number;
  businessVat: number;
  privateVat: number;
  hint: string;
} {
  const lower = text.toLowerCase();
  const fuel = FUEL_KEYWORDS.some((k) => lower.includes(k));
  const mixed = PRIVATE_MIXED_KEYWORDS.some((k) => lower.includes(k));
  if (!fuel || !mixed || brutto <= 0) {
    return {
      businessGross: brutto,
      privateGross: 0,
      businessVat: mwst19 + mwst7,
      privateVat: 0,
      hint: ''
    };
  }

  const fuelLineMatch = text.match(/(?:super|diesel|benzin|kraftstoff)[^\d]{0,20}([\d.,]{1,20})/i);
  const fuelAmount = fuelLineMatch ? parseAmount(fuelLineMatch[1]) : brutto * 0.7;
  const businessGross = Math.max(0, Math.min(brutto, fuelAmount));
  const privateGross = Math.max(0, brutto - businessGross);
  const totalVat = mwst19 + mwst7;
  const businessVat = brutto > 0 ? totalVat * (businessGross / brutto) : totalVat;
  const privateVat = Math.max(0, totalVat - businessVat);
  return {
    businessGross,
    privateGross,
    businessVat,
    privateVat,
    hint: 'Mischbeleg erkannt (Kraftstoff + private Positionen). Bitte manuell pruefen.'
  };
}

function mapAccounts(belegart: BelegArt, steuerkategorie: string, mwst19: number, mwst7: number, mwst0: number): {
  soll: string;
  haben: string;
} {
  if (belegart === 'Einnahme') {
    let haben = '8400';
    if (mwst0 > 0 || (mwst19 === 0 && mwst7 === 0)) haben = '8290'; // SKR03: Erlöse 0% USt (z.B. PV-Nullsteuersatz)
    else if (mwst7 > 0) haben = '8300';
    return { soll: '1200', haben };
  }

  if (steuerkategorie === 'Kraftstoff/Benzin') return { soll: '4530', haben: '1200' };
  if (steuerkategorie === 'Bewirtung') return { soll: '4650', haben: '1200' };
  if (steuerkategorie === 'IT/Hosting') return { soll: '4930', haben: '1200' };
  if (steuerkategorie === 'Strom/Energie') return { soll: '4250', haben: '1200' };
  if (steuerkategorie === 'Miete') return { soll: '4210', haben: '1200' };
  return { soll: '4980', haben: '1200' };
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:\"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function buildUnifiedFilename(doc: ParsedDoc, originalName: string): string {
  const ext = path.extname(originalName) || '.pdf';
  const date = doc.belegdatum || '0000-00-00';
  const supplier = sanitizeFilename(doc.lieferant || 'Unbekannt');
  const no = sanitizeFilename(doc.belegnr || doc.belegId || 'ohneNummer');
  const gross = doc.bruttoGesamt > 0 ? `${doc.bruttoGesamt.toFixed(2)}EUR` : 'BetragUnbekannt';
  const type = doc.belegart === 'Einnahme' ? 'Einnahme' : 'Ausgabe';
  return `${date}_${type}_${supplier}_${no}_${gross}${ext}`.slice(0, 180);
}

function shouldMoveToPrivate(text: string, supplier: string, doc: ParsedDoc): boolean {
  const lower = `${text}\n${supplier}`.toLowerCase();
  if (PRIVATE_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (doc.belegart === 'Ausgabe' && doc.mwst0 > 0) return true;
  return false;
}

function shouldMoveToArchive(text: string, supplier: string): boolean {
  const lower = `${text}\n${supplier}`.toLowerCase();
  if (ARCHIVE_KEYWORDS.some((k) => lower.includes(k))) return true;
  if ((lower.includes('ionos') || lower.includes('1&1')) && !INVOICE_KEYWORDS.some((k) => lower.includes(k))) return true;
  return false;
}

async function ensureSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<number> {
  const ss = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  });
  const existing = (ss.data.sheets || []).find((s) => s.properties?.title === title);
  const existingSheetId = existing?.properties?.sheetId;
  if (typeof existingSheetId === 'number') return existingSheetId;
  const create = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Failed to create sheet ${title}`);
  return id;
}

async function getBelegeRows(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<BelegeRow[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'belege'
  });
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);
  const iId = idx('id');
  const iDrive = idx('drive_file_id');
  const iName = idx('original_name');
  const iMime = idx('mime_type');
  const iSrc = idx('source_folder_id');
  const iTgt = idx('target_folder_id');
  const iUrl = idx('file_url');
  const iExt = idx('extracted_text');
  const iOcr = idx('ocr_text');
  const iMeta = idx('metadata');

  const rows: BelegeRow[] = [];
  values.slice(1).forEach((row, index) => {
    rows.push({
      rowNumber: index + 2,
      id: row[iId] || '',
      driveFileId: row[iDrive] || '',
      originalName: row[iName] || '',
      mimeType: row[iMime] || '',
      sourceFolderId: row[iSrc] || '',
      targetFolderId: row[iTgt] || '',
      fileUrl: row[iUrl] || '',
      extractedText: row[iExt] || '',
      ocrText: row[iOcr] || '',
      metadata: row[iMeta] || ''
    });
  });
  return rows.filter((row) => Boolean(row.driveFileId));
}

async function getYearPriorityDriveIds(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  year: string
): Promise<Set<string>> {
  const tabs = [`Einnahmen_${year}`, `Ausgaben_${year}`];
  const ids = new Set<string>();

  for (const tab of tabs) {
    try {
      const response = await runWithRateLimitRetry(
        () => sheets.spreadsheets.values.get({
          spreadsheetId,
          range: tab
        }),
        `priorityYear.read.${tab}`
      );
      const values = response.data.values || [];
      if (values.length <= 1) continue;
      const headers = values[0];
      const iDrive = headers.indexOf('drive_file_id');
      if (iDrive < 0) continue;
      for (const row of values.slice(1)) {
        const id = row[iDrive] || '';
        if (id) ids.add(id);
      }
    } catch (error) {
      console.warn(`Priority tab read failed for ${tab}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return ids;
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const maxFiles = Number.parseInt(process.env.MAX_FILES_PER_RUN || '300', 10);
  const ocrMinTextLength = Number.parseInt(process.env.OCR_MIN_TEXT_LENGTH || '20', 10);
  const flushSize = Number.parseInt(process.env.BATCH_FLUSH_SIZE || '50', 10);
  const renameFiles = ['1', 'true', 'yes'].includes((process.env.RENAME_FILES || 'true').toLowerCase());
  const doMoves = ['1', 'true', 'yes'].includes((process.env.APPLY_MOVE_RULES || 'true').toLowerCase());
  const priorityYear = (process.env.PRIORITY_YEAR || '').trim();
  const disableOcrFallback = ['1', 'true', 'yes'].includes((process.env.DISABLE_OCR_FALLBACK || 'false').toLowerCase());
  const enableQwenFallback = ['1', 'true', 'yes'].includes((process.env.ENABLE_QWEN_FALLBACK || 'true').toLowerCase());

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });
  const driveService = new GoogleDriveService(credentialsPath);

  const dbSheetTitle = 'Buchhaltung_DB';
  const dbSheetId = await ensureSheet(sheets, spreadsheetId, dbSheetTitle);

  const dbHeaders = [
    'drive_file_id',
    'file_url',
    'dateiname_original',
    'dateiname_standardisiert',
    'belegart',
    'lieferant',
    'kunde',
    'belegnr',
    'beleg_id',
    'belegdatum',
    'leistungsdatum',
    'steuerkategorie',
    'mwst_19_betrag',
    'mwst_7_betrag',
    'mwst_0_betrag',
    'netto_gesamt',
    'brutto_gesamt',
    'geschaeftliche_mwst',
    'private_mwst',
    'geschaeftlicher_anteil_brutto',
    'privater_anteil_brutto',
    'sollkonto',
    'habenkonto',
    'iban',
    'bic',
    'bankleitzahl',
    'hinweis',
    'duplikat_gruppe',
    'status',
    'line_items_json',
    'source_folder_id',
    'target_folder_id',
    'analyzed_at'
  ];

  const existingDb = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${dbSheetTitle}`
  });
  const dbRows = existingDb.data.values || [];
  const existingByDriveId = new Map<string, string[]>();
  if (dbRows.length > 1) {
    for (const row of dbRows.slice(1)) {
      const driveId = row[0] || '';
      if (driveId) existingByDriveId.set(driveId, row);
    }
  }

  const belegeRows = await getBelegeRows(sheets, spreadsheetId);
  const priorityIds = priorityYear ? await getYearPriorityDriveIds(sheets, spreadsheetId, priorityYear) : new Set<string>();
  for (const row of belegeRows) {
    if (existingByDriveId.has(row.driveFileId)) continue;
    existingByDriveId.set(row.driveFileId, [
      row.driveFileId,
      row.fileUrl,
      row.originalName,
      row.originalName,
      'Unklar',
      '',
      '',
      '',
      row.id || row.driveFileId,
      '',
      '',
      '',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'pending',
      '[]',
      row.sourceFolderId,
      row.targetFolderId,
      ''
    ]);
  }

  const pending = belegeRows.filter((row) => {
    const existing = existingByDriveId.get(row.driveFileId);
    const hasDb = Boolean(existing);
    const hasText = Boolean((row.extractedText || '').trim()) || Boolean((row.ocrText || '').trim());
    const extractionStatus = getExtractionStatusFromMetadata(row.metadata);
    const permanentlyNoText = extractionStatus === 'final_no_text';
    return !hasDb || (!hasText && !permanentlyNoText);
  })
    .sort((a, b) => {
      const ap = priorityIds.has(a.driveFileId) ? 1 : 0;
      const bp = priorityIds.has(b.driveFileId) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return a.rowNumber - b.rowNumber;
    })
    .slice(0, maxFiles);

  console.log(`Total belege: ${belegeRows.length}`);
  console.log(`Pending for enrichment this run: ${pending.length} (max ${maxFiles})`);
  console.log(`Flush size: ${flushSize} | disable OCR fallback: ${disableOcrFallback}`);
  console.log(`Qwen fallback enabled: ${enableQwenFallback}`);
  if (priorityYear) {
    const priorityPending = pending.filter((row) => priorityIds.has(row.driveFileId)).length;
    console.log(`Priority year ${priorityYear}: ${priorityIds.size} ids, ${priorityPending} in current batch`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belege-enrich-'));
  let worker: Worker | null = null;
  const belegeUpdates: sheets_v4.Schema$ValueRange[] = [];
  let belegeUpdateCount = 0;
  const nowIso = new Date().toISOString();
  const dedupeByBusinessKey = new Map<string, string>();

  const flushBelegeUpdates = async (): Promise<void> => {
    if (belegeUpdates.length === 0) return;
    for (let i = 0; i < belegeUpdates.length; i += 100) {
      const chunk = belegeUpdates.slice(i, i + 100);
      await runWithRateLimitRetry(
        () => sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: chunk
          }
        }),
        `belege.batchUpdate.${i / 100}`
      );
    }
    belegeUpdates.length = 0;
  };

  try {
    let done = 0;
    for (const row of pending) {
      done++;
      let extracted = (row.extractedText || '').trim();
      let ocr = (row.ocrText || '').trim();
      const filePath = path.join(tempDir, `${row.driveFileId}${path.extname(row.originalName) || '.bin'}`);
      let textForParse = extracted || ocr;
      const extLower = row.originalName.toLowerCase();
      const isPdf = row.mimeType === 'application/pdf' || extLower.endsWith('.pdf');
      const isImage = row.mimeType.startsWith('image/');
      let extractionStatus = 'ok';
      let extractionNote = '';

      try {
        if (!textForParse) {
          // Skip binary/unknown files where OCR/PDF extraction would be pointless.
          if (!isPdf && !isImage) {
            textForParse = '';
            extractionStatus = 'final_no_text';
            extractionNote = 'unsupported_type';
          } else {
            await runWithRateLimitRetry(
              () => driveService.downloadFile(row.driveFileId, filePath),
              `download.${row.driveFileId}`
            );
          }

          let effectivePdf = isPdf;
          let effectiveImage = isImage;
          if (fs.existsSync(filePath)) {
            const kind = detectBinaryKind(filePath);
            if (kind === 'pdf') {
              effectivePdf = true;
              effectiveImage = false;
            } else if (kind === 'image') {
              effectivePdf = false;
              effectiveImage = true;
            } else if (!effectivePdf && !effectiveImage) {
              extractionStatus = 'final_no_text';
              extractionNote = 'unsupported_binary';
            }
          }

          if (effectivePdf && fs.existsSync(filePath)) {
            let needsOcrFallback = false;
            let qwenImagePath = '';
            try {
              extracted = await extractPdfText(filePath);
              textForParse = extracted;
              needsOcrFallback = !textForParse || textForParse.length < ocrMinTextLength;
            } catch (pdfExtractError) {
              console.warn(`PDF text extraction failed for ${row.driveFileId}: ${pdfExtractError instanceof Error ? pdfExtractError.message : String(pdfExtractError)}`);
              needsOcrFallback = true;
            }

            if (needsOcrFallback && !disableOcrFallback) {
              try {
                worker = await ensureWorker(worker);
                const pngNoExt = path.join(tempDir, `${row.driveFileId}_p1`);
                const png = await renderFirstPdfPageToPng(filePath, pngNoExt);
                qwenImagePath = png;
                ocr = await ocrWithTesseract(worker, png);
                textForParse = ocr;
              } catch (ocrError) {
                console.warn(`PDF OCR fallback failed for ${row.driveFileId}: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
              }
            }

            const needsQwenFallback = shouldUseQwenFallback(textForParse, ocrMinTextLength);
            if (needsQwenFallback && enableQwenFallback) {
              try {
                if (!qwenImagePath) {
                  const pngNoExt = path.join(tempDir, `${row.driveFileId}_p1_qwen`);
                  qwenImagePath = await renderFirstPdfPageToPng(filePath, pngNoExt);
                }
                const qwenText = await ocrWithQwenFallback(qwenImagePath);
                if (qwenText) {
                  ocr = qwenText;
                  textForParse = qwenText;
                  extractionStatus = 'ok';
                  extractionNote = extractionNote || 'qwen_fallback_used';
                }
              } catch (qwenError) {
                console.warn(`Qwen fallback failed for ${row.driveFileId}: ${qwenError instanceof Error ? qwenError.message : String(qwenError)}`);
              }
            }
          } else if (effectiveImage && fs.existsSync(filePath)) {
            if (!disableOcrFallback) {
              try {
                worker = await ensureWorker(worker);
                ocr = await ocrWithTesseract(worker, filePath);
                textForParse = ocr;
              } catch (ocrError) {
                console.warn(`Image OCR failed for ${row.driveFileId}: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
              }
            }
            const needsQwenFallback = shouldUseQwenFallback(textForParse, ocrMinTextLength);
            if (needsQwenFallback && enableQwenFallback) {
              try {
                const qwenText = await ocrWithQwenFallback(filePath);
                if (qwenText) {
                  ocr = qwenText;
                  textForParse = qwenText;
                  extractionStatus = 'ok';
                  extractionNote = extractionNote || 'qwen_fallback_used';
                }
              } catch (qwenError) {
                console.warn(`Qwen fallback failed for ${row.driveFileId}: ${qwenError instanceof Error ? qwenError.message : String(qwenError)}`);
              }
            }
          }

          if (!(textForParse || '').trim()) {
            extractionStatus = 'final_no_text';
            extractionNote = extractionNote || 'no_extractable_text';
          }
        }
      } catch (extractError) {
        console.warn(`Extraction failed for ${row.driveFileId}: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
        extractionStatus = 'final_no_text';
        extractionNote = extractionNote || 'extraction_exception';
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      const text = clampText(textForParse || '');
      const lieferant = detectSupplier(text, row.originalName.replace(/\.[a-z0-9]+$/i, ''));
      const kunde = detectCustomer(text);
      const belegnr = detectInvoiceNo(text);
      const belegdatum = toIsoDate(text);
      const leistungsdatum = belegdatum;
      const iban = detectIban(text);
      const bic = detectBic(text);
      const bankleitzahl = iban.startsWith('DE') && iban.length >= 12 ? iban.slice(4, 12) : '';
      const mwst19 = extractVatAmount(text, '19');
      const mwst7 = extractVatAmount(text, '7');
      const mwst0 = extractVatAmount(text, '0');
      const brutto = extractGross(text);
      const netto = extractNet(text);
      const steuerkategorie = classifySteuerkategorie(text);
      const belegart = detectBelegart(text, lieferant, kunde);
      const split = computePrivateSplit(text, brutto, mwst19, mwst7);
      const accounts = mapAccounts(belegart, steuerkategorie, mwst19, mwst7, mwst0);

      let hinweis = split.hint;
      let status = 'ok';
      let duplicateGroup = '';

      const businessKey = `${lieferant.toLowerCase()}|${belegnr.toLowerCase()}|${belegdatum}|${brutto.toFixed(2)}`;
      if (lieferant && belegnr && brutto > 0) {
        const existingDup = dedupeByBusinessKey.get(businessKey);
        if (existingDup && existingDup !== row.driveFileId) {
          duplicateGroup = businessKey;
          status = 'duplicate_candidate';
          if (doMoves && row.targetFolderId !== DUPLICATE_FOLDER_ID) {
            try {
              await runWithRateLimitRetry(
                () => driveService.moveFile(row.driveFileId, DUPLICATE_FOLDER_ID),
                `moveDuplicate.${row.driveFileId}`
              );
              hinweis = `${hinweis ? `${hinweis} ` : ''}Als Duplikat erkannt und in Duplikate verschoben.`.trim();
            } catch (moveError) {
              hinweis = `${hinweis ? `${hinweis} ` : ''}Duplikatverschiebung fehlgeschlagen.`.trim();
            }
          }
        } else {
          dedupeByBusinessKey.set(businessKey, row.driveFileId);
        }
      }

      const parsed: ParsedDoc = {
        belegart,
        lieferant,
        kunde,
        belegnr,
        belegId: row.id || row.driveFileId,
        belegdatum,
        leistungsdatum,
        steuerkategorie,
        mwst19,
        mwst7,
        mwst0,
        nettoGesamt: netto,
        bruttoGesamt: brutto,
        geschaeftlicheMwst: split.businessVat,
        privateMwst: split.privateVat,
        geschaeftlicherAnteilBrutto: split.businessGross,
        privaterAnteilBrutto: split.privateGross,
        sollkonto: accounts.soll,
        habenkonto: accounts.haben,
        iban,
        bic,
        bankleitzahl,
        hinweis,
        duplicateGroup,
        status,
        lineItemsJson: '[]'
      };

      let renamed = row.originalName;
      if (renameFiles) {
        const targetName = buildUnifiedFilename(parsed, row.originalName);
        if (targetName && targetName !== row.originalName) {
          try {
            await runWithRateLimitRetry(
              () => driveApi.files.update({
                fileId: row.driveFileId,
                requestBody: { name: targetName },
                fields: 'id,name',
                supportsAllDrives: true
              }),
              `rename.${row.driveFileId}`
            );
            renamed = targetName;
          } catch (renameError) {
            console.warn(`Rename failed for ${row.driveFileId}: ${renameError instanceof Error ? renameError.message : String(renameError)}`);
          }
        }
      }

      if (doMoves) {
        const toPrivate = shouldMoveToPrivate(text, lieferant, parsed);
        const toArchive = shouldMoveToArchive(text, lieferant);
        const desired = toArchive ? ARCHIVE_FOLDER_ID : (toPrivate ? PRIVATE_FOLDER_ID : '');
        if (desired && row.targetFolderId !== desired) {
          try {
            await runWithRateLimitRetry(
              () => driveService.moveFile(row.driveFileId, desired),
              `moveRules.${row.driveFileId}`
            );
          } catch (moveErr) {
            console.warn(`Rule move failed for ${row.driveFileId}: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`);
          }
        }
      }

      const metadataObject = {
        accounting_version: 1,
        extraction_status: extractionStatus,
        extraction_note: extractionNote,
        supplier: parsed.lieferant,
        invoice_no: parsed.belegnr,
        invoice_date: parsed.belegdatum,
        vat_19: parsed.mwst19,
        vat_7: parsed.mwst7,
        vat_0: parsed.mwst0,
        gross_total: parsed.bruttoGesamt,
        net_total: parsed.nettoGesamt,
        tax_category: parsed.steuerkategorie,
        sollkonto: parsed.sollkonto,
        habenkonto: parsed.habenkonto,
        status: parsed.status
      };

      belegeUpdates.push({
        range: `belege!G${row.rowNumber}:K${row.rowNumber}`,
        values: [[
          clampText(extracted || '', 45000),
          clampText(ocr || '', 45000),
          '',
          '',
          JSON.stringify(metadataObject)
        ]]
      });

      if (belegeUpdates.length >= flushSize) {
        await flushBelegeUpdates();
      }
      belegeUpdateCount++;

      existingByDriveId.set(row.driveFileId, [
        row.driveFileId,
        row.fileUrl,
        row.originalName,
        renamed,
        parsed.belegart,
        parsed.lieferant,
        parsed.kunde,
        parsed.belegnr,
        parsed.belegId,
        parsed.belegdatum,
        parsed.leistungsdatum,
        parsed.steuerkategorie,
        parsed.mwst19.toFixed(2),
        parsed.mwst7.toFixed(2),
        parsed.mwst0.toFixed(2),
        parsed.nettoGesamt.toFixed(2),
        parsed.bruttoGesamt.toFixed(2),
        parsed.geschaeftlicheMwst.toFixed(2),
        parsed.privateMwst.toFixed(2),
        parsed.geschaeftlicherAnteilBrutto.toFixed(2),
        parsed.privaterAnteilBrutto.toFixed(2),
        parsed.sollkonto,
        parsed.habenkonto,
        parsed.iban,
        parsed.bic,
        parsed.bankleitzahl,
        parsed.hinweis,
        parsed.duplicateGroup,
        parsed.status,
        parsed.lineItemsJson,
        row.sourceFolderId,
        row.targetFolderId,
        nowIso
      ]);

      if (done % 20 === 0 || done === pending.length) {
        console.log(`Processed ${done}/${pending.length}`);
      }
    }

    await flushBelegeUpdates();

    const belegeIdSet = new Set(belegeRows.map((row) => row.driveFileId));
    const finalRows = Array.from(existingByDriveId.entries())
      .filter(([driveId]) => belegeIdSet.has(driveId))
      .map(([, value]) => value)
      .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
    await runWithRateLimitRetry(
      () => sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${dbSheetTitle}!A:ZZ`
      }),
      'db.clear'
    );
    await runWithRateLimitRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${dbSheetTitle}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [dbHeaders, ...finalRows] }
      }),
      'db.update'
    );

    await runWithRateLimitRetry(
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: dbSheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: dbSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: dbHeaders.length
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true }
                  }
                },
                fields: 'userEnteredFormat.textFormat.bold'
              }
            },
            {
              setBasicFilter: {
                filter: {
                  range: {
                    sheetId: dbSheetId,
                    startRowIndex: 0,
                    endRowIndex: Math.max(1, finalRows.length + 1),
                    startColumnIndex: 0,
                    endColumnIndex: dbHeaders.length
                  }
                }
              }
            }
          ]
        }
      }),
      'db.format'
    );

    console.log(JSON.stringify({
      totalBelege: belegeRows.length,
      processedThisRun: pending.length,
      dbRows: finalRows.length,
      belegeUpdated: belegeUpdateCount
    }, null, 2));
  } finally {
    if (worker) {
      await worker.terminate();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

withPipelineLock('accounting_enrichment', main).catch((error) => {
  console.error('accounting_enrichment failed:', error);
  process.exit(1);
});
