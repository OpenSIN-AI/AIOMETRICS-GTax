# Context Fulltext

- source_path: src/orchestrator/micro_local_118_tesseract_filter.ts
- source_sha256: d1b52e68b2bebdfbf930d6154d4707760364974384064dd98fdf8890041952f8
- chunk: 1/2

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createWorker, Worker } from 'tesseract.js';
import { withPipelineLock } from './pipeline_lock.js';

const execFileAsync = promisify(execFile);

const LOCAL_ROOT = process.env.LOCAL_118_FOLDER
  || '/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud/118_525_01062';
const SOURCE_DRIVE_FOLDER_ID = process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.LOCAL_118_BATCH || '5', 10);
const UPLOAD_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_UPLOAD || '0').toLowerCase());
const DELETE_DUPLICATES = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_DELETE_DUPLICATES || '1').toLowerCase());
const DELETE_AFTER_UPLOAD = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_DELETE_AFTER_UPLOAD || '1').toLowerCase());
const OCR_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_118_OCR_TIMEOUT_MS || '20000', 10);
const MAX_FILE_MB = Number.parseInt(process.env.LOCAL_118_MAX_FILE_MB || '8', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.LOCAL_118_RUN_BUDGET_MS || '170000', 10);
const CURSOR_FILE = process.env.LOCAL_118_CURSOR_FILE || path.join(process.cwd(), 'logs', 'local118_cursor.json');
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_LOCAL_118_TESSERACT_FILTER.md');

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

let ocrWorker: Worker | null = null;

interface ExistingRow {
  id: string;
  textBlob: string;
}

interface Decision {
  file: string;
  action: 'delete_duplicate' | 'upload' | 'skip_private' | 'skip_tax7' | 'skip_income_19' | 'skip_non_zoe_income' | 'skip_error' | 'skip_unknown';
  reason: string;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

interface CursorState {
  cursor: number;
  totalLastSeen: number;
  updatedAt: string;
}

function readCursor(total: number): number {
  try {
    if (!fs.existsSync(CURSOR_FILE)) return 0;
    const raw = fs.readFileSync(CURSOR_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CursorState;
    if (!Number.isFinite(parsed.cursor)) return 0;
    if (total <= 0) return 0;
    return Math.max(0, Math.floor(parsed.cursor)) % total;
  } catch {
    return 0;
  }
}

function writeCursor(nextCursor: number, total: number): void {
  try {
    fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
    const payload: CursorState = {
      cursor: nextCursor,
      totalLastSeen: total,
      updatedAt: new Date().toISOString()
    };
    const tmp = CURSOR_FILE + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, CURSOR_FILE);
  } catch {
    // ignore cursor write errors
  }
}

function takeBatchWithCursor(allFiles: string[], start: number, size: number): { batch: string[]; nextCursor: number } {
  if (allFiles.length === 0) return { batch: [], nextCursor: 0 };
  const out: string[] = [];
  let idx = start % allFiles.length;
  while (out.length < size && out.length < allFiles.length) {
    out.push(allFiles[idx]);
    idx = (idx + 1) % allFiles.length;
  }
  return { batch: out, nextCursor: idx };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout_${ms}ms`)), ms);
    promise.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function getAllLocalFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      const n = e.name.toLowerCase();
      if (n.endsWith('.pdf') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp')) {
        out.push(full);
      }
    }
  }
  return out;
}

async function renderPdfFirstPage(pdfPath: string, outNoExt: string): Promise<string> {
  await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', pdfPath, outNoExt]);
  return `${outNoExt}.png`;
}

async function ensureWorker(): Promise<Worker> {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await createWorker('deu+eng');
  return ocrWorker;
}

async function tesseractTextForFile(filePath: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local118-ocr-'));
  const outNoExt = path.join(tmpDir, 'page1');
  let imagePath = filePath;
  try {
    if (filePath.toLowerCase().endsWith('.pdf')) {
      imagePath = await renderPdfFirstPage(filePath, outNoExt);
    }
    const worker = await ensureWorker();
    const res = await worker.recognize(imagePath);
    return String(res.data.text || '').trim();
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

async function loadExistingRows(): Promise<{ rows: ExistingRow[]; invoiceSet: Set<string> }> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ'
  });
  const values = (res.data.values || []) as string[][];
  const header = values[0] || [];
  const idxId = header.indexOf('drive_file_id');
  const idxInv = header.indexOf('Rechnungsnr') >= 0 ? header.indexOf('Rechnungsnr') : header.indexOf('invoice_no');
  const idxName = header.indexOf('original_name');
  const idxExt = header.indexOf('extracted_text');
  const idxOcr = header.indexOf('ocr_text');
  const rows: ExistingRow[] = [];
  const invoiceSet = new Set<string>();
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const id = String(r[idxId] || '').trim();
    if (!id) continue;
    const inv = normalize(String(r[idxInv] || '').trim());
    if (inv && inv.length >= 4) invoiceSet.add(inv);
    const blob = normalize([
      r[idxName] || '',
      r[idxExt] || '',
      r[idxOcr] || '',
      r[idxInv] || ''
    ].join('\n'));
    rows.push({ id, textBlob: blob });
  }
  return { rows, invoiceSet };
}

function parseInvoiceNo(text: string): string {
  const m = text.match(/(?:rechnungs?nr\.?|rechnung\s*nr\.?|invoice\s*no\.?|belegnr\.?|nr\.?)\s*[:#]?\s*([a-z0-9.\-\/]{4,})/i);
  return normalize(m?.[1] || '');
}

function parseDate(text: string): string {
  const m = text.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/](?:20)?\d{2})\b/);
  return normalize(m?.[1] || '');
}

function parseAmount(text: string): string {
  const matches = [...text.matchAll(/\b(\d{1,5}[.,]\d{2})\s*(?:eur|€)?\b/gi)].map((x) => x[1]);
  if (matches.length === 0) return '';
  const best = matches[matches.length - 1];
  return normalize(best.replace(',', '.'));
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function isDuplicateByContent(text: string, invoiceNo: string, dateToken: [REDACTED], amountToken: [REDACTED], rows: ExistingRow[], invoiceSet: Set<string>): boolean {
  if (invoiceNo && invoiceSet.has(invoiceNo)) return true;
  if (!dateToken && !amountToken) return false;
  for (const r of rows) {
    if (dateToken && amountToken && r.textBlob.includes(dateToken) && r.textBlob.includes(amountToken)) return true;
  }
  return false;
}

async function uploadToDrive(localPath: string): Promise<void> {
  await drive.files.create({
    requestBody: {
      name: path.basename(localPath),
      parents: [SOURCE_DRIVE_FOLDER_ID]
    },
    media: {
      mimeType: localPath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png',
      body: fs.createReadStream(localPath)
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true
  });
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  if (!fs.existsSync(LOCAL_ROOT)) throw new Error(`Local folder not found: ${LOCAL_ROOT}`);
  const runStart = Date.now();

  const [allFilesUnsorted, existing] = await Promise.all([
    Promise.resolve(getAllLocalFiles(LOCAL_ROOT)),
    loadExistingRows()
  ]);
  const allFiles = [...allFilesUnsorted].sort((a, b) => a.localeCompare(b));
  const startCursor = readCursor(allFiles.length);
  const { batch, nextCursor } = takeBatchWithCursor(allFiles, startCursor, Math.max(1, BATCH_SIZE));
  writeCursor(nextCursor, allFiles.length);

  const decisions: Decision[] = [];
  const privateMarkers = ['lidl', 'rewe', 'edeka', 'flink', 'wolt', 'lieferando', 'netflix', 'apotheke', 'tierfutter', 'drogerie', 'lebensmittel', 'zigarette', 'tabak', 'bier', 'woolworth', 'hdi', 'aok', 'sbk', 'arag', 'miete', 'vattenfall'];
  const zoeMarkers = ['zoe solar', 'jeremy schulze'];

  for (const localPath of batch) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      decisions.push({ file: localPath, action: 'skip_unknown', reason: 'run_budget_exhausted' });
      continue;
    }
    try {
      const st = fs.statSync(localPath);
      if (st.size > MAX_FILE_MB * 1024 * 1024) {
        decisions.push({ file: localPath, action: 'skip_unknown', reason: `file_too_large_${(st.size / 1024 / 1024).toFixed(1)}mb` });
        continue;
      }
      const textRaw = await withTimeout(tesseractTextForFile(localPath), OCR_TIMEOUT_MS);
      const text = normalize(`${path.basename(localPath)}\n${textRaw}`);
      const invoiceNo = parseInvoiceNo(text);
      const dateToken = [REDACTED]);
      const amountToken = [REDACTED]);
      const isDup = isDuplicateByContent(text, invoiceNo, dateToken, amountToken, existing.rows, existing.invoiceSet);
      const has7 = /\b7\s?%|\b7,0\s?%|erm[aä]ssigt|erm[aä]ßigt/.test(text);
      const has19 = /\b19\s?%|\b19,0\s?%/.test(text);
      const has0 = /\b0\s?%|\b0,0\s?%/.test(text);
      const isPrivate = includesAny(text, privateMarkers);
      const looksIncome = /rechnung|abschlagsrechnung|schlussrechnung|teilrechnung|invoice/.test(text) && (/kunde|auftraggeber|leistungsempf[äa]nger/.test(text) || includesAny(text, zoeMarkers));
      const isZoe = includesAny(text, zoeMarkers);

      if (isDup) {
        if (DELETE_DUPLICATES) safeUnlink(localPath);
        decisions.push({ file: [REDACTED]
        continue;
      }
      if (isPrivate) {
        decisions.push({ file: localPath, action: 'skip_private', reason: 'private_marker_detected' });
        continue;
      }
      if (has7) {
        decisions.push({ file: localPath, action: 'skip_tax7', reason: '7_percent_tax_detected' });
        continue;
      }
      if (looksIncome && has19) {
        decisions.push({ file: localPath, action: 'skip_income_19', reason: 'income_invoice_19_percent' });
        continue;
      }
      if (looksIncome && (!isZoe || !has0)) {
        decisions.push({ file: localPath, action: 'skip_non_zoe_income', reason: 'income_not_zoe_0_percent' });
        continue;
      }

      if (UPLOAD_ENABLED) {
        await uploadToDrive(localPath);
        if (DELETE_AFTER_UPLOAD) safeUnlink(localPath);
        d
```
