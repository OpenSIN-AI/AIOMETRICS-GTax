import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const SOURCE_DRIVE_FOLDER_ID = process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
const TARGET_DRIVE_FOLDER_ID = process.env.TARGET_DRIVE_FOLDER_ID || '11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const APPLY = !['0', 'false', 'no', 'off'].includes(String(process.env.MICRO_PRUNE_APPLY || '1').toLowerCase());
const PRUNE_DB_STALE_IDS = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_PRUNE_DB_STALE_IDS || '0').toLowerCase());
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_PRUNE_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_PRUNE_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_PRUNE_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_PRUNE_API_RETRY_MAX_MS, 15000);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_PRUNE_SHEET_ONLY_DRIVE.md');
const ADDITIONAL_ROOT_FOLDERS = new Set(['Sonstige_Belege', 'Neue Belege', 'Neue Belege ']);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_prune_sheet_only_drive'
  });
}

function isYearFolderName(name: string): boolean {
  return /^20\d{2}$/.test(String(name || '').trim());
}

async function listChildren(folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const response = await withApiRetry(
      `drive.files.list.${folderId}`,
      () => drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }, { timeout: REQUEST_TIMEOUT_MS })
    );
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function buildGateARootFolders(): Promise<string[]> {
  const roots = new Set<string>([SOURCE_DRIVE_FOLDER_ID, TARGET_DRIVE_FOLDER_ID]);
  const topLevel = await listChildren(ACCOUNTING_ROOT_FOLDER_ID);
  for (const folder of topLevel) {
    const id = String(folder.id || '').trim();
    if (!id) continue;
    if (folder.mimeType !== 'application/vnd.google-apps.folder') continue;
    const name = String(folder.name || '').trim();
    if (isYearFolderName(name) || ADDITIONAL_ROOT_FOLDERS.has(name)) {
      roots.add(id);
    }
  }
  return Array.from(roots);
}

async function listDriveIdsFromRoots(rootFolderIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const queue = [...rootFolderIds];
  const visited = new Set<string>();
  while (queue.length) {
    const folderId = queue.shift() as string;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listChildren(folderId);
    for (const child of children) {
      const id = String(child.id || '').trim();
      if (!id) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') queue.push(id);
      else ids.add(id);
    }
  }
  return ids;
}

async function getSheetMeta(): Promise<Map<string, number>> {
  const response = await withApiRetry(
    'sheets.spreadsheets.get.meta',
    () => sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  const map = new Map<string, number>();
  for (const sheet of response.data.sheets || []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && typeof id === 'number') map.set(title, id);
  }
  return map;
}

async function readRows(tab: string): Promise<Array<Array<string | number>>> {
  const response = await withApiRetry(
    `sheets.values.get.${tab}`,
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A1:AZ`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  return (response.data.values || []) as Array<Array<string | number>>;
}

interface DeletePlan {
  rows: number[];
  entries: Array<{ row: number; driveFileId: string; originalName: string }>;
}

function buildDeletePlan(
  rows: Array<Array<string | number>>,
  driveIdIndex: number,
  nameIndex: number,
  keepIds: Set<string>
): DeletePlan {
  const toDelete: Array<{ row: number; driveFileId: string; originalName: string }> = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const driveFileId = String(row[driveIdIndex] || '').trim();
    if (!driveFileId) continue;
    if (!keepIds.has(driveFileId)) {
      toDelete.push({
        row: i + 1,
        driveFileId,
        originalName: String(row[nameIndex] || '')
      });
    }
  }
  toDelete.sort((a, b) => b.row - a.row);
  return {
    rows: toDelete.map((item) => item.row),
    entries: toDelete
  };
}

function buildDeletePlanByDriveIdSet(
  rows: Array<Array<string | number>>,
  driveIdIndex: number,
  nameIndex: number,
  deleteIds: Set<string>
): DeletePlan {
  const toDelete: Array<{ row: number; driveFileId: string; originalName: string }> = [];
  if (deleteIds.size === 0) return { rows: [], entries: [] };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const driveFileId = String(row[driveIdIndex] || '').trim();
    if (!driveFileId || !deleteIds.has(driveFileId)) continue;
    toDelete.push({
      row: i + 1,
      driveFileId,
      originalName: String(row[nameIndex] || '')
    });
  }
  toDelete.sort((a, b) => b.row - a.row);
  return {
    rows: toDelete.map((item) => item.row),
    entries: toDelete
  };
}

async function applyDeleteRows(sheetId: number, rows: number[]): Promise<void> {
  if (rows.length === 0) return;
  const requests: sheets_v4.Schema$Request[] = rows.map((row) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: row - 1,
        endIndex: row
      }
    }
  }));
  for (let i = 0; i < requests.length; i += 200) {
    const chunk = requests.slice(i, i + 200);
    await withApiRetry(
      `sheets.batchUpdate.deleteRows.${sheetId}.${i / 200}`,
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: chunk }
      }, { timeout: REQUEST_TIMEOUT_MS })
    );
  }
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const rootFolders = await buildGateARootFolders();
  const driveIds = await listDriveIdsFromRoots(rootFolders);
  const [sheetMeta, belegeRows, dbRows] = await Promise.all([
    getSheetMeta(),
    readRows('belege'),
    PRUNE_DB_STALE_IDS ? readRows('Buchhaltung_DB') : Promise.resolve([])
  ]);

  const belegeHeaders = (belegeRows[0] || []).map((v) => String(v || '').trim());
  const belegeDriveIdx = belegeHeaders.indexOf('drive_file_id');
  const belegeNameIdx = belegeHeaders.indexOf('original_name');

  if (belegeDriveIdx < 0) throw new Error('drive_file_id missing in belege');
  if (belegeNameIdx < 0) throw new Error('original_name missing in belege');

  const belegePlan = buildDeletePlan(belegeRows, belegeDriveIdx, belegeNameIdx, driveIds);
  const staleBelegeDriveIds = new Set(belegePlan.entries.map((entry) => entry.driveFileId));
  let dbPlan: DeletePlan = { rows: [], entries: [] };
  if (PRUNE_DB_STALE_IDS) {
    const dbHeaders = (dbRows[0] || []).map((v) => String(v || '').trim());
    const dbDriveIdx = dbHeaders.indexOf('drive_file_id');
    const dbNameIdx = dbHeaders.indexOf('dateiname_original');
    if (dbDriveIdx < 0) throw new Error('drive_file_id missing in Buchhaltung_DB');
    if (dbNameIdx < 0) throw new Error('dateiname_original missing in Buchhaltung_DB');
    dbPlan = buildDeletePlanByDriveIdSet(dbRows, dbDriveIdx, dbNameIdx, staleBelegeDriveIds);
  }

  const belegeSheetId = sheetMeta.get('belege');
  if (typeof belegeSheetId !== 'number') throw new Error('belege sheet not found');

  const dbSheetId = PRUNE_DB_STALE_IDS ? sheetMeta.get('Buchhaltung_DB') : undefined;
  if (PRUNE_DB_STALE_IDS && typeof dbSheetId !== 'number') throw new Error('Buchhaltung_DB sheet not found');

  if (APPLY) {
    await applyDeleteRows(belegeSheetId, belegePlan.rows);
    if (PRUNE_DB_STALE_IDS && typeof dbSheetId === 'number') {
      await applyDeleteRows(dbSheetId, dbPlan.rows);
    }
  }

  const lines: string[] = [];
  lines.push('# MICRO Prune Sheet-Only Drive IDs');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Apply mode: ${APPLY}`);
  lines.push(`- DB stale-ID prune enabled: ${PRUNE_DB_STALE_IDS}`);
  lines.push(`- Drive file IDs in watched roots: ${driveIds.size}`);
  lines.push(`- stale belege drive IDs: ${staleBelegeDriveIds.size}`);
  lines.push(`- belege rows removed: ${belegePlan.rows.length}`);
  lines.push(`- Buchhaltung_DB rows removed: ${dbPlan.rows.length}`);
  lines.push('');
  lines.push('## belege removals');
  lines.push('');
  lines.push('| row | drive_file_id | original_name |');
  lines.push('|---:|---|---|');
  for (const entry of belegePlan.entries) {
    lines.push(`| ${entry.row} | ${entry.driveFileId} | ${entry.originalName.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  lines.push('## Buchhaltung_DB removals');
  lines.push('');
  lines.push('| row | drive_file_id | dateiname_original |');
  lines.push('|---:|---|---|');
  for (const entry of dbPlan.entries) {
    lines.push(`| ${entry.row} | ${entry.driveFileId} | ${entry.originalName.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    apply: APPLY,
    pruneDbStaleIds: PRUNE_DB_STALE_IDS,
    driveIds: driveIds.size,
    staleBelegeDriveIds: staleBelegeDriveIds.size,
    belegeRemoved: belegePlan.rows.length,
    dbRemoved: dbPlan.rows.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_prune_sheet_only_drive', main).catch((error) => {
  console.error(error);
  process.exit(1);
});
