# Context Fulltext

- source_path: src/orchestrator/accounting_enrichment.ts
- source_sha256: 65bdc2911fce09bd90e1b1758d81ff4c4799cb3d30880dcdeece1d5deca046f2
- chunk: 1/3

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createWorker, Worker } from 'tesseract.js';
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
  const date = doc.bel
```
