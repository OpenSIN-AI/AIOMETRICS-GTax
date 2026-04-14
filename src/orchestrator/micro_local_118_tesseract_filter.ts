import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
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
const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.LOCAL_118_BATCH || '5', 10);
const UPLOAD_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_UPLOAD || '0').toLowerCase());
const DELETE_DUPLICATES = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_DELETE_DUPLICATES || '1').toLowerCase());
const DELETE_AFTER_UPLOAD = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_DELETE_AFTER_UPLOAD || '1').toLowerCase());
const DELETE_UNUSABLE = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_DELETE_UNUSABLE || '1').toLowerCase());
const CHECK_DRIVE_MD5_DUPES = ['1', 'true', 'yes', 'on'].includes(String(process.env.LOCAL_118_CHECK_DRIVE_MD5_DUPES || '1').toLowerCase());
const OCR_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_118_OCR_TIMEOUT_MS || '20000', 10);
const OCR_SECOND_PASS_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_118_SECOND_PASS_OCR_TIMEOUT_MS || '60000', 10);
const MAX_FILE_MB = Number.parseInt(process.env.LOCAL_118_MAX_FILE_MB || '8', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.LOCAL_118_RUN_BUDGET_MS || '170000', 10);
const API_MAX_RETRIES = Number.parseInt(process.env.LOCAL_118_API_MAX_RETRIES || '4', 10);
const API_RETRY_BASE_MS = Number.parseInt(process.env.LOCAL_118_API_RETRY_BASE_MS || '1500', 10);
const API_MAX_BACKOFF_MS = Number.parseInt(process.env.LOCAL_118_API_MAX_BACKOFF_MS || '20000', 10);
const GOOGLE_IMPERSONATE_USER = String(process.env.GOOGLE_IMPERSONATE_USER || '').trim();
const UPLOAD_FALLBACK_FOLDER_IDS = String(process.env.LOCAL_118_UPLOAD_FALLBACK_FOLDER_IDS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const UNREADABLE_POLICY = String(process.env.LOCAL_118_UNREADABLE_POLICY || 'upload_quarantine').toLowerCase();
const QUARANTINE_FOLDER_ID_ENV = String(process.env.LOCAL_118_QUARANTINE_FOLDER_ID || '').trim();
const QUARANTINE_FOLDER_NAME = String(process.env.LOCAL_118_QUARANTINE_FOLDER_NAME || '__LOCAL118_UNREADABLE_QUARANTINE__').trim();
const CURSOR_FILE = process.env.LOCAL_118_CURSOR_FILE || path.join(process.cwd(), 'logs', 'local118_cursor.json');
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_LOCAL_118_TESSERACT_FILTER.md');

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  ...(GOOGLE_IMPERSONATE_USER ? { subject: GOOGLE_IMPERSONATE_USER } : {}),
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
  action:
    | 'delete_duplicate'
    | 'delete_unusable'
    | 'upload'
    | 'quarantine_upload'
    | 'skip_error'
    | 'skip_unknown';
  reason: string;
}

interface ApiErrorLike {
  code?: string | number;
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
  };
  errors?: Array<{ reason?: string }>;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function md5ForFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
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

async function listDriveMd5Set(rootFolderId: string): Promise<Set<string>> {
  const md5s = new Set<string>();
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const folderId = queue.shift();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);

    let pageToken: string | undefined;
    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,mimeType,md5Checksum)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      for (const file of response.data.files || []) {
        const fileId = String(file.id || '').trim();
        if (!fileId) continue;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(fileId);
          continue;
        }
        const md5 = String(file.md5Checksum || '').trim().toLowerCase();
        if (md5) md5s.add(md5);
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }

  return md5s;
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

function escapeDriveNameQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isTimeoutLikeError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  return msg.includes('timeout_');
}

function extractApiError(error: unknown): { status: number; code: string; reason: string; message: string } {
  const err = (error || {}) as ApiErrorLike;
  const status = Number(err.response?.status || err.code || 0);
  const code = String(err.code || '');
  const reason =
    String(err.errors?.[0]?.reason || '') ||
    String(err.response?.data?.error?.errors?.[0]?.reason || '');
  const message = String(err.response?.data?.error?.message || err.message || '');
  return { status, code, reason, message };
}

function isRetryableApiError(error: unknown): boolean {
  const { status, code, reason, message } = extractApiError(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) return true;
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError', 'internalError'].includes(reason)) return true;
  const msg = message.toLowerCase();
  return msg.includes('timeout') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('backend error');
}

function isStorageQuotaError(error: unknown): boolean {
  const { reason, message } = extractApiError(error);
  return reason === 'storageQuotaExceeded'
    || message.toLowerCase().includes('storage quota')
    || message.toLowerCase().includes('storagequotaexceeded');
}

function isDuplicateByContent(text: string, invoiceNo: string, dateToken: string, amountToken: string, rows: ExistingRow[], invoiceSet: Set<string>): boolean {
  if (invoiceNo && invoiceSet.has(invoiceNo)) return true;
  if (!dateToken && !amountToken) return false;
  for (const r of rows) {
    if (dateToken && amountToken && r.textBlob.includes(dateToken) && r.textBlob.includes(amountToken)) return true;
  }
  return false;
}

async function uploadToDrive(localPath: string, targetFolderId = SOURCE_DRIVE_FOLDER_ID, nameOverride?: string): Promise<string> {
  const lower = localPath.toLowerCase();
  const mimeType = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'image/jpeg'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
  const attempts = Math.max(1, API_MAX_RETRIES);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await drive.files.create({
        requestBody: {
          name: nameOverride || path.basename(localPath),
          parents: [targetFolderId]
        },
        media: {
          mimeType,
          body: fs.createReadStream(localPath)
        },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true
      });
      return String(response.data.id || '').trim();
    } catch (error) {
      const retryable = isRetryableApiError(error);
      const isLast = attempt >= attempts;
      if (!retryable || isLast) throw error;
      const jitterMs = Math.floor(Math.random() * 250);
      const delayMs = Math.min(API_MAX_BACKOFF_MS, API_RETRY_BASE_MS * attempt + jitterMs);
      await sleep(delayMs);
    }
  }
  throw new Error('uploadToDrive: exhausted retries');
}

async function uploadWithFallback(localPath: string, nameOverride?: string): Promise<{ fileId: string; folderId: string }> {
  const folderCandidates = [SOURCE_DRIVE_FOLDER_ID, ...UPLOAD_FALLBACK_FOLDER_IDS]
    .map((x) => x.trim())
    .filter(Boolean);
  const uniqueFolderCandidates = Array.from(new Set(folderCandidates));
  if (uniqueFolderCandidates.length === 0) {
    throw new Error('No upload target folder configured');
  }

  let lastError: unknown;
  for (let i = 0; i < uniqueFolderCandidates.length; i++) {
    const folderId = uniqueFolderCandidates[i];
    try {
      const fileId = await uploadToDrive(localPath, folderId, nameOverride);
      return { fileId, folderId };
    } catch (error) {
      lastError = error;
      const storageQuotaError = isStorageQuotaError(error);
      const hasMoreTargets = i < uniqueFolderCandidates.length - 1;
      if (storageQuotaError && hasMoreTargets) {
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'uploadWithFallback failed'));
}

async function ensureQuarantineFolderId(): Promise<string> {
  if (QUARANTINE_FOLDER_ID_ENV) return QUARANTINE_FOLDER_ID_ENV;
  const escapedName = escapeDriveNameQuery(QUARANTINE_FOLDER_NAME);
  const existing = await drive.files.list({
    q: `'${SOURCE_DRIVE_FOLDER_ID}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${escapedName}'`,
    fields: 'files(id,name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const existingId = String(existing.data.files?.[0]?.id || '').trim();
  if (existingId) return existingId;
  const created = await drive.files.create({
    requestBody: {
      name: QUARANTINE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [SOURCE_DRIVE_FOLDER_ID]
    },
    fields: 'id',
    supportsAllDrives: true
  });
  const createdId = String(created.data.id || '').trim();
  if (!createdId) throw new Error('Failed to create/find local118 quarantine folder');
  return createdId;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  if (!fs.existsSync(LOCAL_ROOT)) throw new Error(`Local folder not found: ${LOCAL_ROOT}`);
  const runStart = Date.now();

  const [allFilesUnsorted, existing, driveMd5Set] = await Promise.all([
    Promise.resolve(getAllLocalFiles(LOCAL_ROOT)),
    loadExistingRows(),
    CHECK_DRIVE_MD5_DUPES ? listDriveMd5Set(ACCOUNTING_ROOT_FOLDER_ID) : Promise.resolve(new Set<string>())
  ]);
  const allFiles = [...allFilesUnsorted].sort((a, b) => a.localeCompare(b));
  const startCursor = readCursor(allFiles.length);
  const { batch, nextCursor } = takeBatchWithCursor(allFiles, startCursor, Math.max(1, BATCH_SIZE));
  writeCursor(nextCursor, allFiles.length);
  const shouldQuarantineUnreadable = UNREADABLE_POLICY === 'upload_quarantine';
  let quarantineFolderId = '';
  if (shouldQuarantineUnreadable) {
    quarantineFolderId = await ensureQuarantineFolderId();
  }

  const decisions: Decision[] = [];
  const privateMarkers = ['privat', 'private'];
  const unusableMarkers = [
    'lebensmittel',
    'supermarkt',
    'rewe',
    'edeka',
    'lidl',
    'aldi',
    'kaufland',
    'penny',
    'netto',
    'drogerie',
    'rossmann',
    'dm ',
    'lieferando',
    'wolt',
    'restaurant',
    'imbiss',
    'zigarette',
    'zigaretten',
    'tabak',
    'bier'
  ];
  const zoeMarkers = ['zoe solar', 'jeremy schulze'];

  for (const localPath of batch) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      decisions.push({ file: localPath, action: 'skip_unknown', reason: 'run_budget_exhausted' });
      continue;
    }
    try {
      const st = fs.statSync(localPath);
      if (st.size > MAX_FILE_MB * 1024 * 1024) {
        if (shouldQuarantineUnreadable && quarantineFolderId) {
          await uploadToDrive(localPath, quarantineFolderId, `UNREADABLE_FILE_TOO_LARGE_${path.basename(localPath)}`);
          if (DELETE_AFTER_UPLOAD) safeUnlink(localPath);
          decisions.push({ file: localPath, action: 'quarantine_upload', reason: `file_too_large_${(st.size / 1024 / 1024).toFixed(1)}mb` });
          continue;
        }
        decisions.push({ file: localPath, action: 'skip_unknown', reason: `file_too_large_${(st.size / 1024 / 1024).toFixed(1)}mb` });
        continue;
      }
      const localMd5 = await md5ForFile(localPath);
      if (CHECK_DRIVE_MD5_DUPES && localMd5 && driveMd5Set.has(localMd5)) {
        if (DELETE_DUPLICATES) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_duplicate', reason: `duplicate_by_drive_md5:${localMd5}` });
        continue;
      }
      let textRaw = '';
      try {
        textRaw = await withTimeout(tesseractTextForFile(localPath), OCR_TIMEOUT_MS);
      } catch (ocrError) {
        try {
          if (isTimeoutLikeError(ocrError) && OCR_SECOND_PASS_TIMEOUT_MS > OCR_TIMEOUT_MS) {
            textRaw = await withTimeout(tesseractTextForFile(localPath), OCR_SECOND_PASS_TIMEOUT_MS);
          } else {
            throw ocrError;
          }
        } catch (secondOcrError: any) {
          const ocrReason = String(secondOcrError?.message || secondOcrError).slice(0, 180);
          if (shouldQuarantineUnreadable && quarantineFolderId) {
            await uploadToDrive(localPath, quarantineFolderId, `UNREADABLE_${path.basename(localPath)}`);
            if (DELETE_AFTER_UPLOAD) safeUnlink(localPath);
            decisions.push({ file: localPath, action: 'quarantine_upload', reason: `ocr_unreadable:${ocrReason}` });
          } else {
            decisions.push({ file: localPath, action: 'skip_error', reason: ocrReason });
          }
          continue;
        }
      }
      const text = normalize(`${path.basename(localPath)}\n${textRaw}`);
      const invoiceNo = parseInvoiceNo(text);
      const dateToken = parseDate(text);
      const amountToken = parseAmount(text);
      const isDup = isDuplicateByContent(text, invoiceNo, dateToken, amountToken, existing.rows, existing.invoiceSet);
      const has7 = /\b7\s?%|\b7,0\s?%|erm[aä]ssigt|erm[aä]ßigt/.test(text);
      const has19 = /\b19\s?%|\b19,0\s?%/.test(text);
      const has0 = /\b0\s?%|\b0,0\s?%/.test(text);
      const isPrivate = includesAny(text, privateMarkers);
      const isUnusable = includesAny(text, unusableMarkers);
      const looksIncome = /rechnung|abschlagsrechnung|schlussrechnung|teilrechnung|invoice/.test(text)
        && (/kunde|auftraggeber|leistungsempf[äa]nger/.test(text) || includesAny(text, zoeMarkers));
      const isZoe = includesAny(text, zoeMarkers);

      if (isDup) {
        if (DELETE_DUPLICATES) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_duplicate', reason: `duplicate_by_content inv=${invoiceNo || '-'} date=${dateToken || '-'} amount=${amountToken || '-'}` });
        continue;
      }
      if (isPrivate) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'private_marker_detected' });
        continue;
      }
      if (isUnusable) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'unusable_marker_detected' });
        continue;
      }
      if (isZoe && looksIncome && has19) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'zoe_invoice_19_percent' });
        continue;
      }
      if (isZoe && looksIncome && !has0 && (has7 || has19 || /(?:mwst|ust|umsatzsteuer)/.test(text))) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'zoe_invoice_not_0_percent' });
        continue;
      }

      if (UPLOAD_ENABLED) {
        const uploaded = await uploadWithFallback(localPath);
        if (localMd5) driveMd5Set.add(localMd5);
        if (DELETE_AFTER_UPLOAD) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'upload', reason: `uploaded_to_drive:${uploaded.folderId}` });
      } else {
        decisions.push({ file: localPath, action: 'skip_unknown', reason: 'eligible_but_upload_disabled' });
      }
    } catch (e: any) {
      console.error('Error in tesseract filter processing:', e);
      decisions.push({ file: localPath, action: 'skip_error', reason: String(e?.message || e).slice(0, 180) });
    }
  }

  const counts = decisions.reduce<Record<string, number>>((a, d) => {
    a[d.action] = (a[d.action] || 0) + 1;
    return a;
  }, {});

  const lines: string[] = [];
  lines.push('# MICRO Local 118 Tesseract Filter');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Local root: ${LOCAL_ROOT}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Total local files found: ${allFiles.length}`);
  lines.push(`- Cursor start: ${startCursor}`);
  lines.push(`- Cursor next: ${nextCursor}`);
  lines.push(`- Processed now: ${batch.length}`);
  lines.push(`- Counts: ${JSON.stringify(counts)}`);
  lines.push('');
  lines.push('| action | reason | file |');
  lines.push('|---|---|---|');
  for (const d of decisions) lines.push(`| ${d.action} | ${d.reason.replace(/\|/g, '/')} | ${d.file.replace(/\|/g, '/')} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    localRoot: LOCAL_ROOT,
    totalFiles: allFiles.length,
    cursorStart: startCursor,
    cursorNext: nextCursor,
    processed: batch.length,
    runBudgetMs: RUN_BUDGET_MS,
    elapsedMs: Date.now() - runStart,
    counts,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_local_118_tesseract_filter', main).finally(async () => {
  if (ocrWorker) {
    try {
      await ocrWorker.terminate();
    } catch {
      // best effort worker shutdown
    }
  }
  setTimeout(() => process.exit(0), 100);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
