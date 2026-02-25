import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const ARCHIVE_FOLDER_ID = process.env.ARCHIVE_FOLDER_ID || '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SHEET_DELETE_ARCHIVE_SYNC.md');
const MAX_MOVES = Number.parseInt(process.env.MICRO_SHEET_DELETE_MAX_MOVES || '30', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.MICRO_SHEET_DELETE_REQUEST_TIMEOUT_MS || '30000', 10);
const API_MAX_RETRIES = Number.parseInt(process.env.MICRO_SHEET_DELETE_API_MAX_RETRIES || '4', 10);
const API_RETRY_BASE_MS = Number.parseInt(process.env.MICRO_SHEET_DELETE_API_RETRY_BASE_MS || '1500', 10);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

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

function extractError(error: unknown): { status: number; code: string; reason: string; message: string } {
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
  const { status, code, reason, message } = extractError(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) return true;
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'].includes(reason)) return true;
  const msg = message.toLowerCase();
  return msg.includes('timeout') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('backend error');
}

async function apiCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, API_MAX_RETRIES);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableApiError(error);
      const isLast = attempt >= maxAttempts;
      if (!retryable || isLast) {
        throw error;
      }
      const jitterMs = Math.floor(Math.random() * 250);
      const delayMs = Math.min(15000, API_RETRY_BASE_MS * attempt + jitterMs);
      const meta = extractError(error);
      console.warn(`[micro_sheet_delete_archive_sync] ${operation} failed (${attempt}/${maxAttempts}), retry in ${delayMs}ms: ${meta.message || meta.reason || meta.code || meta.status}`);
      await sleep(delayMs);
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function getSheetValues(range: string): Promise<string[][]> {
  const r = await apiCall(
    `sheets.values.get.${range}`,
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  return (r.data.values || []) as string[][];
}

async function moveFileToArchive(fileId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const meta = await apiCall(
      `drive.files.get.${fileId}`,
      () => drive.files.get({
        fileId,
        fields: 'id,parents',
        supportsAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    const parents = (meta.data.parents || []).join(',');
    await apiCall(
      `drive.files.update.${fileId}`,
      () => drive.files.update({
        fileId,
        addParents: ARCHIVE_FOLDER_ID,
        removeParents: parents,
        requestBody: {},
        supportsAllDrives: true,
        fields: 'id'
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    return { ok: true, reason: 'moved_to_archive' };
  } catch (e: any) {
    console.error('Error during moveFileToArchive:', e);
    return { ok: false, reason: String(e?.message || e).slice(0, 160) };
  }
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const [belegeRows, syncRows] = await Promise.all([
    getSheetValues('belege!A1:AZ'),
    getSheetValues('sync_state!A1:A')
  ]);

  const belegeHeaders = belegeRows[0] || [];
  const idxDrive = belegeHeaders.indexOf('drive_file_id');
  if (idxDrive < 0) throw new Error('belege.drive_file_id missing');

  const currentIds = new Set<string>();
  for (let i = 1; i < belegeRows.length; i++) {
    const id = String(belegeRows[i]?.[idxDrive] || '').trim();
    if (id) currentIds.add(id);
  }

  const prevIds = new Set<string>();
  for (let i = 1; i < syncRows.length; i++) {
    const id = String(syncRows[i]?.[0] || '').trim();
    if (id) prevIds.add(id);
  }

  const removed = Array.from(prevIds).filter((id) => !currentIds.has(id)).slice(0, Math.max(1, MAX_MOVES));
  const moveResults: Array<{ fileId: string; ok: boolean; reason: string }> = [];
  for (const id of removed) {
    const res = await moveFileToArchive(id);
    moveResults.push({ fileId: id, ok: res.ok, reason: res.reason });
  }

  const syncValues: string[][] = [['drive_file_id'], ...Array.from(currentIds).sort().map((id) => [id])];
  await apiCall(
    'sheets.values.clear.sync_state',
    () => sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'sync_state!A:Z'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  await apiCall(
    'sheets.values.update.sync_state',
    () => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'sync_state!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: syncValues }
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );

  const okCount = moveResults.filter((m) => m.ok).length;
  const failCount = moveResults.length - okCount;

  const lines: string[] = [];
  lines.push('# MICRO Sheet Delete -> Archive Sync');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Current ids: ${currentIds.size}`);
  lines.push(`- Previous ids: ${prevIds.size}`);
  lines.push(`- Removed detected: ${removed.length}`);
  lines.push(`- Moved ok: ${okCount}`);
  lines.push(`- Move failed: ${failCount}`);
  lines.push('');
  lines.push('| file_id | ok | reason |');
  lines.push('|---|---|---|');
  for (const r of moveResults) lines.push(`| ${r.fileId} | ${r.ok} | ${r.reason.replace(/\|/g, '/')} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    currentIds: currentIds.size,
    previousIds: prevIds.size,
    removedDetected: removed.length,
    movedOk: okCount,
    movedFailed: failCount,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_sheet_delete_archive_sync', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
