# Context Fulltext

- source_path: src/legacy/gemini/gemini_ocr_worker.ts
- source_sha256: 0d22c1a5d11269c43c1cfba925c995fc9bb88e29160494798cf8ba261b9ddd41
- chunk: 1/2

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { google } from 'googleapis';
import { createWorker, Worker } from 'tesseract.js';

dotenv.config();

const execFileAsync = promisify(execFile);

const API_KEY = [REDACTED] || '').trim();
const GEMINI_API_KEY = [REDACTED] || '').trim();
const SPREADSHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();
const QWEN_MODEL = (process.env.NVIDIA_QWEN_MODEL || 'qwen/qwen3.5-397b-a17b').trim();
const QWEN_TIMEOUT_MS = Number.parseInt(process.env.NVIDIA_QWEN_TIMEOUT_MS || '180000', 10);
const QWEN_MAX_TOKENS = Number.parseInt(process.env.NVIDIA_QWEN_MAX_TOKENS || '1500', 10);
const WORKER_BATCH_SIZE = Number.parseInt(process.env.WORKER_BATCH_SIZE || '8', 10);
const MIN_TEXT_LEN = Number.parseInt(process.env.OCR_MIN_TEXT_LENGTH || '20', 10);
const MAX_FILE_MB = Number.parseInt(process.env.WORKER_MAX_FILE_MB || '3', 10);
const ABSOLUTE_MAX_FILE_MB = Number.parseInt(process.env.WORKER_ABSOLUTE_MAX_FILE_MB || '35', 10);
const FINAL_NO_TEXT_AFTER_ATTEMPTS = Number.parseInt(process.env.OCR_FINAL_NO_TEXT_AFTER_ATTEMPTS || '3', 10);

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

interface PendingRow {
  rowIndex: number;
  fileId: string;
  name: string;
  mimeType: string;
  metadata: string;
}

let tesseractWorker: Worker | null = null;

function getColumnLetter(colIndex: number): string {
  let letter = '';
  let idx = colIndex;
  while (idx >= 0) {
    letter = String.fromCharCode((idx % 26) + 65) + letter;
    idx = Math.floor(idx / 26) - 1;
  }
  return letter;
}

function isFinalNoText(metadata: string): boolean {
  if (!metadata) return false;
  try {
    const m = JSON.parse(metadata);
    const status = String(m?.extraction_status || m?.extractionStatus || '').toLowerCase();
    return status === 'final_no_text';
  } catch {
    return false;
  }
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
  if (typeof raw?.text === 'string') return raw.text.trim();
  return '';
}

function parseMetadataSafe(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
  } catch {
    // ignore parse error
  }
  return {};
}

function detectImageMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/png';
}

async function exportGoogleFileToPdf(fileId: string, targetPath: string): Promise<boolean> {
  try {
    const response = await drive.files.export(
      {
        fileId,
        mimeType: 'application/pdf'
      },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(targetPath, Buffer.from(response.data as ArrayBuffer));
    return true;
  } catch {
    return false;
  }
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
    // Optional optimization only.
  }
  return { path: imagePath, cleanup: false };
}

async function downloadToFile(fileId: string, targetPath: string): Promise<void> {
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  fs.writeFileSync(targetPath, Buffer.from(response.data as ArrayBuffer));
}

async function renderFirstPdfPageToPng(pdfPath: string, pngNoExt: string): Promise<string> {
  await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', pdfPath, pngNoExt]);
  return `${pngNoExt}.png`;
}

async function analyzeWithQwen(imagePath: string): Promise<string> {
  if (!API_KEY) return '';
  const prepared = await maybePrepareImageForQwen(imagePath);
  try {
    const mimeType = detectImageMime(prepared.path);
    const base64Data = fs.readFileSync(prepared.path).toString('base64');
    const payload = {
      model: QWEN_MODEL,
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
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
          ]
        }
      ]
    };

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: [REDACTED]
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number.isFinite(QWEN_TIMEOUT_MS) && QWEN_TIMEOUT_MS > 0 ? QWEN_TIMEOUT_MS : 180000)
    });
    if (!response.ok) return '';
    const data = await response.json();
    return extractMessageContent((data as any)?.choices?.[0]?.message?.content);
  } finally {
    if (prepared.cleanup && fs.existsSync(prepared.path)) {
      fs.unlinkSync(prepared.path);
    }
  }
}

async function analyzeWithGeminiVision(imagePath: string): Promise<string> {
  if (!GEMINI_API_KEY) return '';
  const prepared = await maybePrepareImageForQwen(imagePath);
  try {
    const mimeType = detectImageMime(prepared.path);
    const base64Data = fs.readFileSync(prepared.path).toString('base64');
    const body = {
      contents: [
        {
          parts: [
            {
              text: 'Extrahiere den gesamten Text aus diesem Beleg. Gib nur Rohtext ohne Erklaerung zurueck.'
            },
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'text/plain'
      }
    };

    const response = await fetch(
      `https: [REDACTED]
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number.isFinite(QWEN_TIMEOUT_MS) && QWEN_TIMEOUT_MS > 0 ? QWEN_TIMEOUT_MS : 180000)
      }
    );
    if (!response.ok) return '';
    const data: any = await response.json();
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return text;
  } catch {
    return '';
  } finally {
    if (prepared.cleanup && fs.existsSync(prepared.path)) {
      fs.unlinkSync(prepared.path);
    }
  }
}

async function ensureTesseractWorker(): Promise<Worker> {
  if (tesseractWorker) return tesseractWorker;
  tesseractWorker = await createWorker('deu+eng');
  return tesseractWorker;
}

async function analyzeWithTesseract(imagePath: string): Promise<string> {
  const worker = await ensureTesseractWorker();
  const result = await worker.recognize(imagePath);
  return (result.data.text || '').trim();
}

async function runWorker(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  if (!API_KEY && !GEMINI_API_KEY) {
    console.warn('No NVIDIA_QWEN or GEMINI_API_KEY configured. Worker will rely on local Tesseract fallback only.');
  }

  const workerId = Math.floor(Math.random() * 10000);
  console.log(`[Worker ${workerId}] Start`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:Z'
  });
  const rows = res.data.values || [];
  const headers = rows[0] || [];

  const idCol = headers.indexOf('drive_file_id');
  const extTextCol = headers.indexOf('extracted_text');
  const ocrTextCol = headers.indexOf('ocr_text');
  const nameCol = headers.indexOf('original_name');
  const mimeCol = headers.indexOf('mime_type');
  const metadataCol = headers.indexOf('metadata');

  if (idCol < 0 || extTextCol < 0 || ocrTextCol < 0 || nameCol < 0 || mimeCol < 0 || metadataCol < 0) {
    throw new Error('belege headers missing required columns');
  }

  const pendingRows: PendingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const fileId = row[idCol] || '';
    if (!fileId) continue;
    const extractedText = row[extTextCol] || '';
    const ocrText = row[ocrTextCol] || '';
    const metadata = row[metadataCol] || '';
    const hasText = extractedText.length >= MIN_TEXT_LEN || ocrText.length >= MIN_TEXT_LEN;
    if (hasText) continue;
    if (isFinalNoText(metadata)) continue;
    pendingRows.push({
      rowIndex: i + 1,
      fileId,
      name: row[nameCol] || '',
      mimeType: row[mimeCol] || '',
      metadata
    });
  }

  if (pendingRows.length === 0) {
    console.log(`[Worker ${workerId}] No pending rows`);
    return;
  }

  const shuffledImages = pendingRows
    .filter((r) => (r.mimeType || '').startsWith('image/'))
    .sort(() => 0.5 - Math.random());
  const shuffledPdfs = pendingRows
    .filter((r) => (r.mimeType || '') === 'application/pdf')
    .sort(() => 0.5 - Math.random());
  const shuffledOther = pendingRows
    .filter((r) => !(r.mimeType || '').startsWith('image/') && (r.mimeType || '') !== 'application/pdf')
    .sort(() => 0.5 - Math.random());
  const batch = [...shuffledImages, ...shuffledPdfs, ...shuffledOther].slice(0, Math.max(1, WORKER_BATCH_SIZE));
  console.log(`[Worker ${workerId}] pending=${pendingRows.length} batch=${batch.length}`);

  const updates: Array<{ range: string; values: string[][] }> = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ocr-worker-${workerId}-`));
  const ocrCol = getColumnLetter(ocrTextCol);
  const metadataColLetter = getColumnLetter(metadataCol);
  let success = 0;
  let failed = 0;
  let noTextFinalized = 0;

  try {
    for (const item of batch) {
      const nowIso = new Date().toISOString();
      const previousMetadata = parseMetadataSafe(item.metadata);
      const attempts = Number(previousMetadata.ocr_attempts || 0) + 1;
      let observedMime = item.mimeType || '';
      let text = '';
      let extractionNote = '';
      let failureReason = '';

      try {
        const meta = await drive.files.get({
          fileId: item.fileId,
          fields: 'mimeType,size',
          supportsAllDrives: true
        });
        const mime = meta.data.mi
```
