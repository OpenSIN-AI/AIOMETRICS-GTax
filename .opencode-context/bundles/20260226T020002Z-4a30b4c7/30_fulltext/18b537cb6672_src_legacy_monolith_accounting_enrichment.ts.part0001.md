# Context Fulltext

- source_path: src/legacy/monolith/accounting_enrichment.ts
- source_sha256: c6b99240f32fa025532b02fdb300cde82b7beed9a2685d0657c505b2d0dd0e1e
- chunk: 1/4

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
  const apiKey = [REDACTED] || '').trim();
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
      max_tokens: [REDACTED]
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
        Authorization: [REDACTED]
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
    /(?:rechnungs(?:nummer|n
```
