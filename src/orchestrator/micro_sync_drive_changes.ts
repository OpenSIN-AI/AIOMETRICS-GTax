import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

interface SyncState {
  pageToken: string;
  updatedAt: string;
}

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const SOURCE_DRIVE_FOLDER_ID = process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
const TARGET_DRIVE_FOLDER_ID = process.env.TARGET_DRIVE_FOLDER_ID || '11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const MAX_CHANGES = Number.parseInt(process.env.MICRO_SYNC_MAX_CHANGES || '40', 10);
const STATE_PATH = process.env.MICRO_SYNC_STATE_PATH || path.join(process.cwd(), 'logs', 'micro_sync_drive_changes_state.json');
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SYNC_DRIVE_CHANGES.md');
const EVENTS_PATH = path.join(process.cwd(), 'logs', 'micro_sync_drive_changes_events.jsonl');

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_SYNC_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_SYNC_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_SYNC_API_RETRY_BASE_MS, 1500);

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

interface BelegeIndex {
  headers: string[];
  headerMap: Map<string, number>;
  rows: string[][];
  rowByDriveId: Map<string, number>;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureEventDir(): void {
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
}

function eventLog(event: string, payload: Record<string, unknown> = {}): void {
  try {
    ensureEventDir();
    fs.appendFileSync(
      EVENTS_PATH,
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...payload
      }) + '\n',
      'utf8'
    );
  } catch {
    // Telemetry must never break the worker.
  }
}

function extractError(error: unknown): { status: number; code: string; reason: string; message: string } {
  const err = (error || {}) as ApiErrorLike;
  const status = Number(err.response?.status || err.code || 0);
  const code = String(err.code || '');
  const reason =
    String(err.errors?.[0]?.reason || '') ||
    String(err.response?.data?.error?.errors?.[0]?.reason || '');
  const message = String(
    err.response?.data?.error?.message ||
    err.message ||
    ''
  );
  return { status, code, reason, message };
}

function isRetryableApiError(error: unknown): boolean {
  const { status, code, reason, message } = extractError(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) {
    return true;
  }
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'].includes(reason)) {
    return true;
  }
  const m = message.toLowerCase();
  return m.includes('timeout') || m.includes('rate limit') || m.includes('quota') || m.includes('backend error');
}

async function apiCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, API_MAX_RETRIES);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    try {
      const result = await fn();
      eventLog('api_ok', {
        operation,
        attempt,
        durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      const meta = extractError(error);
      const retryable = isRetryableApiError(error);
      const isLast = attempt >= maxAttempts;
      eventLog('api_error', {
        operation,
        attempt,
        durationMs: Date.now() - started,
        retryable,
        status: meta.status,
        code: meta.code,
        reason: meta.reason,
        message: meta.message
      });
      if (!retryable || isLast) {
        throw error;
      }
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = Math.min(15000, API_RETRY_BASE_MS * attempt + jitter);
      console.warn(`[micro_sync] ${operation} failed (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms: ${meta.message || meta.reason || meta.code || meta.status}`);
      await sleep(delayMs);
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

function isValidFieldTuple(value: [number, string]): value is [number, string] {
  return Number.isInteger(value[0]) && value[0] >= 0;
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

function readState(): SyncState | null {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SyncState;
    if (!parsed?.pageToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: SyncState): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_PATH);
}

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (pages++ > 50) break; // Hard loop constraint
    const r = await apiCall(
      'drive.files.list.children',
      () => drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,parents)',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    out.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function buildWatchedFolderSet(): Promise<Set<string>> {
  const watched = new Set<string>([
    ACCOUNTING_ROOT_FOLDER_ID,
    SOURCE_DRIVE_FOLDER_ID,
    TARGET_DRIVE_FOLDER_ID
  ]);

  const level1 = await listChildren(ACCOUNTING_ROOT_FOLDER_ID);
  const folderLevel1 = level1.filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.id);
  for (const f of folderLevel1) watched.add(f.id as string);

  for (const parent of folderLevel1) {
    const child = await listChildren(parent.id as string);
    for (const c of child) {
      if (c.mimeType === 'application/vnd.google-apps.folder' && c.id) {
        watched.add(c.id);
      }
    }
  }

  return watched;
}

async function getBelegeIndex(): Promise<BelegeIndex> {
  const res = await apiCall(
    'sheets.values.get.belege',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1:AZ'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const rows = (res.data.values || []) as string[][];
  const headers = rows[0] || [];
  const headerMap = new Map<string, number>();
  headers.forEach((h, i) => headerMap.set(String(h || '').trim(), i));
  const idxDriveId = headerMap.get('drive_file_id') ?? -1;
  const rowByDriveId = new Map<string, number>();
  if (idxDriveId >= 0) {
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i]?.[idxDriveId] || '').trim();
      if (id) rowByDriveId.set(id, i + 1);
    }
  }
  return { headers, headerMap, rows, rowByDriveId };
}

function buildBelegeRowFromFile(file: FileMeta): string[] {
  const fileId = file.id || '';
  const name = file.name || '';
  const mime = file.mimeType || '';
  const size = Number.parseInt(String(file.size || '0'), 10);
  const parentId = file.parents?.[0] || '';
  const nowIso = new Date().toISOString();
  return [
    randomUUID(), // id
    fileId, // drive_file_id
    name, // original_name
    mime, // mime_type
    Number.isFinite(size) ? String(size) : '0', // file_size
    'Unkategorisiert', // category
    '', // extracted_text
    '', // ocr_text
    '', // image_description
    '[]', // tags
    '{}', // metadata
    '0', // confidence
    SOURCE_DRIVE_FOLDER_ID, // source_folder_id
    `https://drive.google.com/drive/folders/${SOURCE_DRIVE_FOLDER_ID}`, // source_folder_url
    parentId, // target_folder_id
    parentId ? `https://drive.google.com/drive/folders/${parentId}` : '', // target_folder_url
    nowIso, // analyzed_at
    nowIso, // moved_at
    file.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '') // file_url
  ];
}

async function ensureStateInitialized(): Promise<SyncState> {
  const existing = readState();
  if (existing?.pageToken) return existing;
  const tokenResp = await apiCall(
    'drive.changes.getStartPageToken',
    () => drive.changes.getStartPageToken({ supportsAllDrives: true }, { timeout: REQUEST_TIMEOUT_MS })
  );
  const token = String(tokenResp.data.startPageToken || '').trim();
  if (!token) throw new Error('Failed to initialize startPageToken');
  const state: SyncState = { pageToken: token, updatedAt: new Date().toISOString() };
  writeState(state);
  eventLog('state_initialized', { tokenLength: token.length });
  return state;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const runId = randomUUID();
  const startedAt = Date.now();
  eventLog('run_start', {
    runId,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: API_MAX_RETRIES,
    maxChanges: MAX_CHANGES
  });
  const state = await ensureStateInitialized();
  const watchedFolders = await buildWatchedFolderSet();
  const belege = await getBelegeIndex();

  const removedIds: string[] = [];
  const upserts: FileMeta[] = [];
  let nextToken = state.pageToken;
  let fetchedChanges = 0;

  const changeResp = await apiCall(
    'drive.changes.list',
    () => drive.changes.list({
      pageToken: state.pageToken,
      pageSize: Math.max(1, MAX_CHANGES),
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,trashed))',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      restrictToMyDrive: false
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );

  const changes = changeResp.data.changes || [];
  fetchedChanges = changes.length;
  for (const c of changes) {
    const fileId = String(c.fileId || c.file?.id || '').trim();
    if (!fileId) continue;
    if (c.removed || c.file?.trashed) {
      removedIds.push(fileId);
      continue;
    }
    const file = c.file as FileMeta | undefined;
    if (!file || !file.id) continue;
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;
    const parentId = file.parents?.[0] || '';
    if (!parentId || !watchedFolders.has(parentId)) continue;
    upserts.push(file);
  }

  nextToken = String(changeResp.data.nextPageToken || changeResp.data.newStartPageToken || state.pageToken);
  writeState({ pageToken: nextToken, updatedAt: new Date().toISOString() });
  eventLog('state_updated', { runId, nextTokenLength: nextToken.length, fetchedChanges });

  const updates: Array<{ range: string; values: string[][] }> = [];
  const clears: string[] = [];
  const appends: string[][] = [];

  for (const fileId of removedIds) {
    const row = belege.rowByDriveId.get(fileId);
    if (!row) continue;
    clears.push(`belege!A${row}:S${row}`);
  }

  const idxOriginalName = belege.headerMap.get('original_name') ?? -1;
  const idxMime = belege.headerMap.get('mime_type') ?? -1;
  const idxSize = belege.headerMap.get('file_size') ?? -1;
  const idxTargetFolderId = belege.headerMap.get('target_folder_id') ?? -1;
  const idxTargetFolderUrl = belege.headerMap.get('target_folder_url') ?? -1;
  const idxMovedAt = belege.headerMap.get('moved_at') ?? -1;
  const idxFileUrl = belege.headerMap.get('file_url') ?? -1;

  for (const file of upserts) {
    const fileId = String(file.id || '').trim();
    if (!fileId) continue;
    const existingRow = belege.rowByDriveId.get(fileId);
    if (!existingRow) {
      appends.push(buildBelegeRowFromFile(file));
      continue;
    }
    const nowIso = new Date().toISOString();
    const parentId = file.parents?.[0] || '';
    const fields = [
      [idxOriginalName, String(file.name || '')],
      [idxMime, String(file.mimeType || '')],
      [idxSize, String(file.size || '0')],
      [idxTargetFolderId, parentId],
      [idxTargetFolderUrl, parentId ? `https://drive.google.com/drive/folders/${parentId}` : ''],
      [idxMovedAt, nowIso],
      [idxFileUrl, String(file.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''))]
    ] as Array<[number, string]>;
    const validFields = fields.filter(isValidFieldTuple);

    for (const [idx, value] of validFields) {
      const col = colLetter(idx);
      updates.push({ range: `belege!${col}${existingRow}`, values: [[value]] });
    }
  }

  if (clears.length > 0) {
    await apiCall(
      'sheets.values.batchClear',
      () => sheets.spreadsheets.values.batchClear({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { ranges: clears }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }
  if (updates.length > 0) {
    await apiCall(
      'sheets.values.batchUpdate',
      () => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }
  if (appends.length > 0) {
    await apiCall(
      'sheets.values.append',
      () => sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'belege!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appends }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }

  const lines: string[] = [];
  lines.push('# MICRO Sync Drive Changes');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Changes fetched: ${fetchedChanges}`);
  lines.push(`- Removed rows cleared: ${clears.length}`);
  lines.push(`- Updated rows: ${updates.length}`);
  lines.push(`- Appended rows: ${appends.length}`);
  lines.push(`- Next page token saved: yes`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    runId,
    fetchedChanges,
    clearedRows: clears.length,
    updatedCells: updates.length,
    appendedRows: appends.length,
    reportPath: REPORT_PATH
  }, null, 2));
  eventLog('run_success', {
    runId,
    elapsedMs: Date.now() - startedAt,
    fetchedChanges,
    clearedRows: clears.length,
    updatedCells: updates.length,
    appendedRows: appends.length
  });
}

withPipelineLock('micro_sync_drive_changes', main).catch((e) => {
  eventLog('run_error', {
    error: e instanceof Error ? e.message : String(e)
  });
  console.error(e);
  process.exit(1);
});
