import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createWorker, Worker } from 'tesseract.js';
import { RUNTIME_POLICY, envInt } from './shared/runtime_policy.js';

const execFileAsync = promisify(execFile);

const SOURCE_FOLDER_ID = '1NMlTFDw6SsyVEy5aimP0Awz3Tq3N1_vH'; // Ausgaben_2023
const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const API_KEY = (process.env.NVIDIA_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const QWEN_MODEL = (process.env.NVIDIA_QWEN_MODEL || 'qwen/qwen3.5-397b-a17b').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
const BATCH_SIZE = envInt('MICRO_1NM_OCR_BATCH', 2);
const RUN_BUDGET_MS = envInt('MICRO_1NM_RUN_BUDGET_MS', RUNTIME_POLICY.defaultRunBudgetMs);
const MODEL_TIMEOUT_MS = envInt('MICRO_1NM_MODEL_TIMEOUT_MS', RUNTIME_POLICY.defaultModelTimeoutMs);
const USE_TESSERACT_EMERGENCY = ['1', 'true', 'yes', 'on'].includes(String(process.env.OCR_EMERGENCY_TESSERACT || '').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_OCR_AUDIT_1NM.md');

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type FileMeta = drive_v3.Schema$File;

interface BelegeRow {
  rowIndex: number;
  extractedText: string;
  ocrText: string;
  originalName: string;
}

interface Candidate {
  file: FileMeta;
  row?: BelegeRow;
}

let tesseractWorker: Worker | null = null;

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractMessageContent(raw: any): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw.map((p) => typeof p === 'string' ? p : (p?.text || '')).join('\n').trim();
  }
  if (typeof raw?.text === 'string') return raw.text.trim();
  return '';
}

function detectImageMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function hasAny(t: string, words: string[]): boolean {
  return words.some((w) => t.includes(w));
}

const PRIVATE_MARKERS = [
  'lidl', 'rewe', 'edeka', 'flink', 'wolt', 'lieferando', 'netflix', 'apotheke',
  'tierfutter', 'drogerie', 'lebensmittel', 'zigarette', 'tabak', 'bier', 'pfand',
  'krombacher', 'berliner kindl', 'monster', 'coca cola', 'salami', 'nahkauf'
];
const FUEL_MARKERS = [
  'kraftstoff', 'benzin', 'diesel', 'super e5', 'super e10', 'tankstelle', 'liter'
];

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (pages++ > 50) break;
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,webViewLink)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function readBelegeRows(): Promise<{ map: Map<string, BelegeRow>; ocrCol: number }> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ'
  });
  const rows = (res.data.values || []) as string[][];
  const header = rows[0] || [];
  const idxId = header.indexOf('drive_file_id');
  const idxExt = header.indexOf('extracted_text');
  const idxOcr = header.indexOf('ocr_text');
  const idxName = header.indexOf('original_name');
  if (idxId < 0 || idxExt < 0 || idxOcr < 0 || idxName < 0) {
    throw new Error('Required belege columns missing');
  }
  const map = new Map<string, BelegeRow>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row[idxId] || '').trim();
    if (!id) continue;
    map.set(id, {
      rowIndex: i + 1,
      extractedText: String(row[idxExt] || ''),
      ocrText: String(row[idxOcr] || ''),
      originalName: String(row[idxName] || '')
    });
  }
  return { map, ocrCol: idxOcr };
}

function colLetter(colIndex0: number): string {
  let n = colIndex0 + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function downloadToFile(fileId: string, targetPath: string): Promise<void> {
  const r = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  fs.writeFileSync(targetPath, Buffer.from(r.data as ArrayBuffer));
}

async function renderFirstPdfPageToPng(pdfPath: string, pngNoExt: string): Promise<string> {
  await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', pdfPath, pngNoExt]);
  return `${pngNoExt}.png`;
}

async function analyzeWithQwen(imagePath: string): Promise<string> {
  if (!API_KEY) return '';
  const mimeType = detectImageMime(imagePath);
  const base64Data = fs.readFileSync(imagePath).toString('base64');
  const payload = {
    model: QWEN_MODEL,
    stream: false,
    temperature: 0,
    top_p: 0.95,
    max_tokens: 1500,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: 'Du bist OCR-Extraktor. Gib nur Rohtext zurueck.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extrahiere den kompletten Text aus diesem Beleg. Nur Text.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      }
    ]
  };
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) return '';
  const data = await response.json();
  return extractMessageContent((data as any)?.choices?.[0]?.message?.content);
}

async function analyzeWithGemini(imagePath: string): Promise<string> {
  if (!GEMINI_API_KEY) return '';
  const mimeType = detectImageMime(imagePath);
  const base64Data = fs.readFileSync(imagePath).toString('base64');
  const body = {
    contents: [
      {
        parts: [
          { text: 'Extrahiere den gesamten Text aus diesem Beleg. Gib nur Rohtext ohne Erklaerung zurueck.' },
          { inlineData: { mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'text/plain'
    }
  };
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    }
  );
  if (!response.ok) return '';
  const data: any = await response.json();
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

async function ensureTesseractWorker(): Promise<Worker> {
  if (tesseractWorker) return tesseractWorker;
  tesseractWorker = await createWorker('deu+eng');
  return tesseractWorker;
}

async function analyzeWithTesseract(imagePath: string): Promise<string> {
  const w = await ensureTesseractWorker();
  const r = await w.recognize(imagePath);
  return String(r.data.text || '').trim();
}

async function moveToPrivate(file: FileMeta): Promise<void> {
  await drive.files.update({
    fileId: file.id as string,
    addParents: PRIVATE_FOLDER_ID,
    removeParents: SOURCE_FOLDER_ID,
    requestBody: {},
    fields: 'id',
    supportsAllDrives: true
  });
}

async function processCandidate(c: Candidate): Promise<{ id: string; name: string; textLen: number; moved: boolean; reason: string; text?: string }> {
  const f = c.file;
  if (!f.id || !f.name) return { id: '', name: '', textLen: 0, moved: false, reason: 'invalid_file' };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-1nm-'));
  const ext = (f.name.match(/(\.[A-Za-z0-9]{2,6})$/)?.[1] || '.bin').toLowerCase();
  const rawPath = path.join(tmpDir, `src${ext}`);
  const pngNoExt = path.join(tmpDir, 'page1');
  let text = '';
  try {
    await downloadToFile(f.id, rawPath);
    let imagePath = rawPath;
    const mime = String(f.mimeType || '');
    if (mime === 'application/pdf' || ext === '.pdf') {
      imagePath = await renderFirstPdfPageToPng(rawPath, pngNoExt);
    }
    text = await analyzeWithGemini(imagePath);
    if (!text || text.length < 20) {
      text = await analyzeWithQwen(imagePath);
    }
    if ((!text || text.length < 20) && USE_TESSERACT_EMERGENCY) {
      text = await analyzeWithTesseract(imagePath);
    }
    const probe = normalize([f.name, c.row?.originalName || '', text].join('\n'));
    const hasPrivate = hasAny(probe, PRIVATE_MARKERS);
    const hasFuel = hasAny(probe, FUEL_MARKERS);
    if (hasPrivate && !hasFuel) {
      await moveToPrivate(f);
      return { id: f.id, name: f.name, textLen: text.length, moved: true, reason: 'ocr_private_without_fuel', text };
    }
    return { id: f.id, name: f.name, textLen: text.length, moved: false, reason: hasFuel ? 'fuel_or_mixed' : 'not_private', text };
  } catch (e: any) {
    return { id: f.id, name: f.name, textLen: text.length, moved: false, reason: `error:${String(e?.message || e).slice(0, 120)}` };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const runStart = Date.now();
  const [files, belege] = await Promise.all([listChildren(SOURCE_FOLDER_ID), readBelegeRows()]);
  const rowMap = belege.map;

  const candidates = files
    .map((file) => ({ file, row: file.id ? rowMap.get(file.id) : undefined }))
    .filter((c) => {
      const t = `${c.row?.extractedText || ''}\n${c.row?.ocrText || ''}`.trim();
      return t.length < 20;
    })
    .slice(0, Math.max(1, BATCH_SIZE));

  const updates: Array<{ range: string; values: string[][] }> = [];
  const moved: Array<{ id: string; name: string; reason: string }> = [];
  const kept: Array<{ id: string; name: string; reason: string }> = [];
  let skippedBudget = 0;

  for (const c of candidates) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - RUNTIME_POLICY.budgetReserveMs) {
      skippedBudget += 1;
      continue;
    }
    const result = await processCandidate(c);
    if (!result.id) continue;
    if (c.row && result.text && result.text.length >= 20) {
      const col = colLetter(belege.ocrCol);
      updates.push({ range: `belege!${col}${c.row.rowIndex}`, values: [[result.text]] });
    }
    if (result.moved) moved.push({ id: result.id, name: result.name, reason: result.reason });
    else kept.push({ id: result.id, name: result.name, reason: result.reason });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });
  }

  const lines: string[] = [];
  lines.push('# MICRO OCR Audit 1NM');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Source Folder: ${SOURCE_FOLDER_ID}`);
  lines.push(`- Batch Size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Model timeout ms: ${MODEL_TIMEOUT_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Candidates (no text): ${candidates.length}`);
  lines.push(`- Skipped due budget: ${skippedBudget}`);
  lines.push(`- OCR text updates in sheet: ${updates.length}`);
  lines.push(`- Moved to private: ${moved.length}`);
  lines.push(`- Kept: ${kept.length}`);
  lines.push('');
  lines.push('## Moved');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const m of moved) lines.push(`| ${m.id} | ${m.reason} | ${m.name} |`);
  lines.push('');
  lines.push('## Kept');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const k of kept) lines.push(`| ${k.id} | ${k.reason} | ${k.name} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    sourceFolderId: SOURCE_FOLDER_ID,
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    modelTimeoutMs: MODEL_TIMEOUT_MS,
    elapsedMs: Date.now() - runStart,
    candidates: candidates.length,
    skippedBudget,
    sheetTextUpdates: updates.length,
    movedToPrivate: moved.length,
    kept: kept.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().finally(async () => {
  if (tesseractWorker) {
    try {
      await tesseractWorker.terminate();
    } catch {
      // best effort worker shutdown
    }
  }
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
