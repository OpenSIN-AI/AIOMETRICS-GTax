import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = String(process.env.GOOGLE_SHEET_ID || '').trim();
const CREDENTIALS_PATH = String(process.env.GOOGLE_CREDENTIALS_PATH || '').trim();
const BATCH_SIZE = parsePositiveInt(process.env.FREE_OCR_BATCH, 120);
const CONCURRENCY = parsePositiveInt(process.env.FREE_OCR_CONCURRENCY, 3);
const RUN_BUDGET_MS = parsePositiveInt(process.env.FREE_OCR_RUN_BUDGET_MS, 20 * 60 * 1000);
const MAX_ROUNDS = parsePositiveInt(process.env.FREE_OCR_MAX_ROUNDS, 50);
const MIN_TEXT_LEN = parsePositiveInt(process.env.FREE_OCR_MIN_TEXT_LEN, 20);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.FREE_OCR_REQUEST_TIMEOUT_MS, 30000);
const PDF_TEXT_MAX_PAGES = parsePositiveInt(process.env.FREE_OCR_PDF_TEXT_MAX_PAGES, 2);
const OCR_PDF_MAX_PAGES = parsePositiveInt(process.env.FREE_OCR_PDF_OCR_MAX_PAGES, 2);
const PDFTOTEXT_TIMEOUT_MS = parsePositiveInt(process.env.FREE_OCR_PDFTOTEXT_TIMEOUT_MS, 12000);
const PDFTOPPM_TIMEOUT_MS = parsePositiveInt(process.env.FREE_OCR_PDFTOPPM_TIMEOUT_MS, 15000);
const PDFTOCAIRO_TIMEOUT_MS = parsePositiveInt(process.env.FREE_OCR_PDFTOCAIRO_TIMEOUT_MS, 15000);
const TESSERACT_TIMEOUT_MS = parsePositiveInt(process.env.FREE_OCR_TESSERACT_TIMEOUT_MS, 20000);
const CMD_MAX_BUFFER_BYTES = parsePositiveInt(process.env.FREE_OCR_CMD_MAX_BUFFER_BYTES, 8 * 1024 * 1024);
const API_MAX_RETRIES = parsePositiveInt(process.env.FREE_OCR_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.FREE_OCR_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.FREE_OCR_API_RETRY_MAX_MS, 15000);
const MAX_FAILS_PER_FILE = parsePositiveInt(process.env.FREE_OCR_MAX_FAILS_PER_FILE, 1);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'FREE_OCR_BACKFILL.md');
const FAIL_CACHE_PATH = String(
  process.env.FREE_OCR_FAIL_CACHE_PATH || path.join(process.cwd(), 'docs', 'FREE_OCR_BACKFILL_FAIL_CACHE.json')
).trim();
const FAIL_CACHE_MAX_ATTEMPTS = parsePositiveInt(process.env.FREE_OCR_FAIL_CACHE_MAX_ATTEMPTS, 3);
const RUN_BUDGET_RESERVE_MS = parsePositiveInt(process.env.FREE_OCR_RUN_BUDGET_RESERVE_MS, 15000);

const HAS_PDFTOTEXT = spawnSync('bash', ['-lc', 'command -v pdftotext >/dev/null 2>&1']).status === 0;
const HAS_PDFTOPPM = spawnSync('bash', ['-lc', 'command -v pdftoppm >/dev/null 2>&1']).status === 0;
const HAS_PDFTOCAIRO = spawnSync('bash', ['-lc', 'command -v pdftocairo >/dev/null 2>&1']).status === 0;
const HAS_TESSERACT = spawnSync('bash', ['-lc', 'command -v tesseract >/dev/null 2>&1']).status === 0;

const auth = new JWT({
  keyFile: CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type Candidate = {
  driveFileId: string;
  rowIndex: number;
  originalName: string;
  mimeType: string;
  extractedText: string;
  ocrText: string;
};

type ProcessResult = {
  candidate: Candidate;
  ok: boolean;
  text: string;
  reason: string;
};

type FailCacheEntry = {
  attempts: number;
  lastReason: string;
  lastSeen: string;
  originalName: string;
};

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'free_ocr_backfill'
  });
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timedOut = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const appendChunk = (
      chunk: Buffer,
      chunks: Buffer[],
      currentBytes: number
    ): number => {
      const nextBytes = currentBytes + chunk.length;
      if (nextBytes <= CMD_MAX_BUFFER_BYTES) {
        chunks.push(chunk);
        return nextBytes;
      }
      const allowed = Math.max(0, CMD_MAX_BUFFER_BYTES - currentBytes);
      if (allowed > 0) chunks.push(chunk.subarray(0, allowed));
      return CMD_MAX_BUFFER_BYTES;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort
      }
    }, Math.max(250, timeoutMs));

    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      stdoutBytes = appendChunk(chunk, stdoutChunks, stdoutBytes);
    });

    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      stderrBytes = appendChunk(chunk, stderrChunks, stderrBytes);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        reject(new Error(`timeout:${command}`));
        return;
      }
      if (code !== 0) {
        const detail = normalizeText(stderr || stdout).slice(0, 240);
        reject(new Error(`exit:${command}:${code ?? 'null'}${signal ? `:${signal}` : ''}${detail ? `:${detail}` : ''}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
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

function extFromName(name: string): string {
  const m = name.match(/(\.[A-Za-z0-9]{2,6})$/);
  return (m?.[1] || '.bin').toLowerCase();
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\u0000/g, '').replace(/\r/g, '').trim();
}

function loadFailCache(): Map<string, FailCacheEntry> {
  try {
    if (!fs.existsSync(FAIL_CACHE_PATH)) return new Map();
    const raw = fs.readFileSync(FAIL_CACHE_PATH, 'utf8');
    if (!raw.trim()) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Partial<FailCacheEntry>>;
    const out = new Map<string, FailCacheEntry>();
    for (const [id, entry] of Object.entries(parsed || {})) {
      const attempts = Math.max(0, Number.parseInt(String(entry?.attempts || 0), 10) || 0);
      if (!id || attempts <= 0) continue;
      out.set(id, {
        attempts,
        lastReason: String(entry?.lastReason || ''),
        lastSeen: String(entry?.lastSeen || ''),
        originalName: String(entry?.originalName || '')
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

function saveFailCache(cache: Map<string, FailCacheEntry>): void {
  const rows = Array.from(cache.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const payload: Record<string, FailCacheEntry> = {};
  for (const [id, entry] of rows) {
    if (!id) continue;
    if (!entry || !Number.isFinite(entry.attempts) || entry.attempts <= 0) continue;
    payload[id] = {
      attempts: Math.max(1, Math.trunc(entry.attempts)),
      lastReason: String(entry.lastReason || ''),
      lastSeen: String(entry.lastSeen || ''),
      originalName: String(entry.originalName || '')
    };
  }
  fs.writeFileSync(FAIL_CACHE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isImageMime(mime: string, ext: string): boolean {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return true;
  return ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp'].includes(ext);
}

async function readCandidates(): Promise<{
  candidates: Candidate[];
  idxExtracted: number;
  idxOcr: number;
}> {
  const response = await withApiRetry(
    'sheets.values.get.belege',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1:AZ'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const rows = (response.data.values || []) as string[][];
  const header = rows[0] || [];

  const idxId = header.indexOf('drive_file_id');
  const idxExtracted = header.indexOf('extracted_text');
  const idxOcr = header.indexOf('ocr_text');
  const idxName = header.indexOf('original_name');
  const idxMime = header.indexOf('mime_type');
  if (idxId < 0 || idxExtracted < 0 || idxOcr < 0 || idxName < 0 || idxMime < 0) {
    throw new Error('Required belege columns are missing');
  }

  const candidates: Candidate[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const driveFileId = String(row[idxId] || '').trim();
    if (!driveFileId) continue;

    const extractedText = String(row[idxExtracted] || '');
    const ocrText = String(row[idxOcr] || '');
    const combinedLen = `${extractedText}\n${ocrText}`.trim().length;
    if (combinedLen >= MIN_TEXT_LEN) continue;

    candidates.push({
      driveFileId,
      rowIndex: i + 1,
      originalName: String(row[idxName] || ''),
      mimeType: String(row[idxMime] || ''),
      extractedText,
      ocrText
    });
  }

  return { candidates, idxExtracted, idxOcr };
}

async function downloadFile(fileId: string, outPath: string): Promise<void> {
  const response = await withApiRetry(
    `drive.files.get.media.${fileId}`,
    () => drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true
    }, {
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  fs.writeFileSync(outPath, Buffer.from(response.data as ArrayBuffer));
}

async function runPdfToText(pdfPath: string): Promise<string> {
  if (!HAS_PDFTOTEXT) return '';
  try {
    const { stdout } = await runCommand(
      'pdftotext',
      ['-f', '1', '-l', String(Math.max(1, PDF_TEXT_MAX_PAGES)), '-layout', pdfPath, '-'],
      PDFTOTEXT_TIMEOUT_MS
    );
    return normalizeText(stdout);
  } catch {
    return '';
  }
}

function collectRenderedPages(tmpDir: string, stem: string, pages: number): string[] {
  const out: string[] = [];
  const single = path.join(tmpDir, `${stem}.png`);
  if (fs.existsSync(single)) out.push(single);
  if (pages > 1) {
    for (let i = 1; i <= pages; i++) {
      const p = path.join(tmpDir, `${stem}-${i}.png`);
      if (fs.existsSync(p)) out.push(p);
    }
  }
  return out;
}

async function renderPdfPages(pdfPath: string, tmpDir: string): Promise<string[]> {
  const pages = Math.max(1, OCR_PDF_MAX_PAGES);
  const stem = 'page';
  const outNoExt = path.join(tmpDir, stem);

  if (HAS_PDFTOPPM) {
    try {
      const args = pages <= 1
        ? ['-f', '1', '-singlefile', '-png', pdfPath, outNoExt]
        : ['-f', '1', '-l', String(pages), '-png', pdfPath, outNoExt];
      await runCommand('pdftoppm', args, PDFTOPPM_TIMEOUT_MS);
      const rendered = collectRenderedPages(tmpDir, stem, pages);
      if (rendered.length > 0) return rendered;
    } catch {
      // fallback below
    }
  }

  if (HAS_PDFTOCAIRO) {
    try {
      const args = pages <= 1
        ? ['-f', '1', '-l', '1', '-singlefile', '-png', pdfPath, outNoExt]
        : ['-f', '1', '-l', String(pages), '-png', pdfPath, outNoExt];
      await runCommand('pdftocairo', args, PDFTOCAIRO_TIMEOUT_MS);
      const rendered = collectRenderedPages(tmpDir, stem, pages);
      if (rendered.length > 0) return rendered;
    } catch {
      // no more fallbacks
    }
  }

  return [];
}

async function runTesseract(imagePath: string): Promise<string> {
  if (!HAS_TESSERACT) return '';
  try {
    const { stdout } = await runCommand(
      'tesseract',
      [imagePath, 'stdout', '-l', 'deu+eng', '--psm', '6'],
      TESSERACT_TIMEOUT_MS
    );
    return normalizeText(stdout);
  } catch {
    return '';
  }
}

async function extractTextFromFile(localPath: string, mimeType: string): Promise<string> {
  const ext = extFromName(localPath);
  const isPdf = String(mimeType || '').toLowerCase() === 'application/pdf' || ext === '.pdf';
  if (isPdf) {
    const parsedText = await runPdfToText(localPath);
    if (parsedText.length >= MIN_TEXT_LEN) return parsedText;
    if (!HAS_TESSERACT) return parsedText;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-ocr-render-'));
    try {
      const pngPaths = await renderPdfPages(localPath, tmpDir);
      if (pngPaths.length === 0) return parsedText;
      let combined = parsedText;
      for (const pngPath of pngPaths) {
        const chunk = await runTesseract(pngPath);
        if (!chunk) continue;
        combined = normalizeText(`${combined}\n${chunk}`);
        if (combined.length >= MIN_TEXT_LEN) return combined;
      }
      return combined;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (isImageMime(mimeType, ext)) {
    return await runTesseract(localPath);
  }

  return '';
}

async function processCandidate(candidate: Candidate): Promise<ProcessResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-ocr-file-'));
  const localPath = path.join(tmpDir, `file${extFromName(candidate.originalName)}`);
  try {
    await downloadFile(candidate.driveFileId, localPath);
    const text = await extractTextFromFile(localPath, candidate.mimeType);
    if (text.length >= MIN_TEXT_LEN) {
      return { candidate, ok: true, text, reason: 'ok' };
    }
    return { candidate, ok: false, text: '', reason: 'text_too_short_or_unreadable' };
  } catch (error: any) {
    return {
      candidate,
      ok: false,
      text: '',
      reason: `error:${String(error?.message || error).slice(0, 120)}`
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runConcurrent<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const out = new Array<TOut>(items.length);
  let cursor = 0;
  const slots = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: slots }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await worker(items[index], index);
      }
    })
  );
  return out;
}

async function runConcurrentWithBudget<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  shouldContinue: () => boolean,
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const out: TOut[] = [];
  let cursor = 0;
  const slots = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: slots }, async () => {
      while (true) {
        if (!shouldContinue()) return;
        const index = cursor++;
        if (index >= items.length) return;
        const result = await worker(items[index], index);
        out.push(result);
      }
    })
  );
  return out;
}

async function applyUpdates(data: Array<{ range: string; values: string[][] }>): Promise<void> {
  if (data.length === 0) return;
  const chunkSize = 300;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await withApiRetry(
      `sheets.values.batchUpdate.${i}`,
      () => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: chunk
        }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  if (!CREDENTIALS_PATH) throw new Error('Missing GOOGLE_CREDENTIALS_PATH');

  const startedAt = Date.now();
  let rounds = 0;
  let totalCandidatesSeen = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let noProgressRounds = 0;
  let skippedByFailCap = 0;
  let skippedByFailCache = 0;
  let budgetStopTriggered = false;
  const sampleFailures: Array<{ id: string; reason: string; name: string }> = [];
  const failCounts = new Map<string, number>();
  const failCache = loadFailCache();
  const hardStopAt = startedAt + Math.max(1000, RUN_BUDGET_MS - RUN_BUDGET_RESERVE_MS);
  const withinBudget = (): boolean => Date.now() < hardStopAt;

  while (rounds < MAX_ROUNDS && Date.now() - startedAt < RUN_BUDGET_MS) {
    if (!withinBudget()) {
      budgetStopTriggered = true;
      break;
    }
    const { candidates, idxExtracted, idxOcr } = await readCandidates();
    if (candidates.length === 0) break;

    rounds++;
    totalCandidatesSeen += candidates.length;
    const eligible = candidates.filter((candidate) => {
      const runFails = failCounts.get(candidate.driveFileId) || 0;
      if (runFails >= MAX_FAILS_PER_FILE) return false;
      const cachedFails = failCache.get(candidate.driveFileId)?.attempts || 0;
      if (cachedFails >= FAIL_CACHE_MAX_ATTEMPTS) return false;
      return true;
    });
    const blockedByRun = candidates.filter((candidate) => (failCounts.get(candidate.driveFileId) || 0) >= MAX_FAILS_PER_FILE).length;
    const blockedByCache = candidates.filter((candidate) => (failCache.get(candidate.driveFileId)?.attempts || 0) >= FAIL_CACHE_MAX_ATTEMPTS).length;
    skippedByFailCap += blockedByRun;
    skippedByFailCache += blockedByCache;
    if (eligible.length === 0) break;

    const batch = eligible.slice(0, BATCH_SIZE);
    const results = await runConcurrentWithBudget(
      batch,
      CONCURRENCY,
      withinBudget,
      async (c) => processCandidate(c)
    );
    if (results.length < batch.length) {
      budgetStopTriggered = true;
    }
    if (results.length === 0) {
      break;
    }
    totalProcessed += results.length;

    const updates: Array<{ range: string; values: string[][] }> = [];
    let roundUpdated = 0;
    for (const result of results) {
      if (result.ok) {
        const text = result.text;
        const row = result.candidate.rowIndex;
        failCache.delete(result.candidate.driveFileId);
        updates.push({
          range: `belege!${colLetter(idxOcr)}${row}`,
          values: [[text]]
        });
        if (!result.candidate.extractedText || result.candidate.extractedText.trim().length < MIN_TEXT_LEN) {
          updates.push({
            range: `belege!${colLetter(idxExtracted)}${row}`,
            values: [[text]]
          });
        }
        roundUpdated++;
        totalUpdated++;
      } else {
        totalFailed++;
        const failCount = (failCounts.get(result.candidate.driveFileId) || 0) + 1;
        failCounts.set(result.candidate.driveFileId, failCount);
        const cached = failCache.get(result.candidate.driveFileId);
        failCache.set(result.candidate.driveFileId, {
          attempts: (cached?.attempts || 0) + 1,
          lastReason: result.reason,
          lastSeen: new Date().toISOString(),
          originalName: result.candidate.originalName
        });
        if (sampleFailures.length < 40) {
          sampleFailures.push({
            id: result.candidate.driveFileId,
            reason: result.reason,
            name: result.candidate.originalName
          });
        }
      }
    }

    await applyUpdates(updates);
    saveFailCache(failCache);

    if (roundUpdated === 0) {
      noProgressRounds++;
    } else {
      noProgressRounds = 0;
    }
    if (budgetStopTriggered) {
      break;
    }
    if (noProgressRounds >= 2) break;
  }

  saveFailCache(failCache);

  const finalRead = await readCandidates();
  const remaining = finalRead.candidates.length;
  const remainingEligible = finalRead.candidates.filter((candidate) => {
    return (failCache.get(candidate.driveFileId)?.attempts || 0) < FAIL_CACHE_MAX_ATTEMPTS;
  }).length;

  const lines: string[] = [];
  lines.push('# FREE OCR Backfill');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Elapsed ms: ${Date.now() - startedAt}`);
  lines.push(`- Rounds: ${rounds}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Concurrency: ${CONCURRENCY}`);
  lines.push(`- Min text len: ${MIN_TEXT_LEN}`);
  lines.push(`- Candidates seen: ${totalCandidatesSeen}`);
  lines.push(`- Processed: ${totalProcessed}`);
  lines.push(`- Updated: ${totalUpdated}`);
  lines.push(`- Failed: ${totalFailed}`);
  lines.push(`- Max fails per file: ${MAX_FAILS_PER_FILE}`);
  lines.push(`- Skipped by fail cap: ${skippedByFailCap}`);
  lines.push(`- Fail cache max attempts: ${FAIL_CACHE_MAX_ATTEMPTS}`);
  lines.push(`- Skipped by fail cache: ${skippedByFailCache}`);
  lines.push(`- Fail cache entries: ${failCache.size}`);
  lines.push(`- Fail cache path: ${FAIL_CACHE_PATH}`);
  lines.push(`- Budget stop triggered: ${budgetStopTriggered}`);
  lines.push(`- Remaining candidates: ${remaining}`);
  lines.push(`- Remaining eligible candidates: ${remainingEligible}`);
  lines.push(`- PDF text max pages: ${PDF_TEXT_MAX_PAGES}`);
  lines.push(`- PDF OCR max pages: ${OCR_PDF_MAX_PAGES}`);
  lines.push(`- Has pdftotext: ${HAS_PDFTOTEXT}`);
  lines.push(`- Has pdftoppm: ${HAS_PDFTOPPM}`);
  lines.push(`- Has pdftocairo: ${HAS_PDFTOCAIRO}`);
  lines.push(`- Has tesseract: ${HAS_TESSERACT}`);
  lines.push('');
  lines.push('## Failures (Top 40)');
  lines.push('');
  lines.push('| drive_file_id | reason | original_name |');
  lines.push('|---|---|---|');
  for (const item of sampleFailures) {
    lines.push(`| ${item.id} | ${item.reason.replace(/\|/g, '/')} | ${item.name.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    rounds,
    elapsedMs: Date.now() - startedAt,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    minTextLen: MIN_TEXT_LEN,
    totalCandidatesSeen,
    totalProcessed,
    totalUpdated,
    totalFailed,
    maxFailsPerFile: MAX_FAILS_PER_FILE,
    skippedByFailCap,
    failCacheMaxAttempts: FAIL_CACHE_MAX_ATTEMPTS,
    skippedByFailCache,
    failCacheEntries: failCache.size,
    failCachePath: FAIL_CACHE_PATH,
    budgetStopTriggered,
    remainingCandidates: remaining,
    remainingEligibleCandidates: remainingEligible,
    pdfTextMaxPages: PDF_TEXT_MAX_PAGES,
    pdfOcrMaxPages: OCR_PDF_MAX_PAGES,
    hasPdftotext: HAS_PDFTOTEXT,
    hasPdftoppm: HAS_PDFTOPPM,
    hasPdftocairo: HAS_PDFTOCAIRO,
    hasTesseract: HAS_TESSERACT,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('free_ocr_backfill', main).catch((error) => {
  console.error(error);
  process.exit(1);
});
