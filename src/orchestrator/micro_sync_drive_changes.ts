import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

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
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,parents)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ'
  });
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
  const tokenResp = await drive.changes.getStartPageToken({ supportsAllDrives: true });
  const token = String(tokenResp.data.startPageToken || '').trim();
  if (!token) throw new Error('Failed to initialize startPageToken');
  const state: SyncState = { pageToken: token, updatedAt: new Date().toISOString() };
  writeState(state);
  return state;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const state = await ensureStateInitialized();
  const watchedFolders = await buildWatchedFolderSet();
  const belege = await getBelegeIndex();

  const removedIds: string[] = [];
  const upserts: FileMeta[] = [];
  let nextToken = state.pageToken;
  let fetchedChanges = 0;

  const changeResp = await drive.changes.list({
    pageToken: state.pageToken,
    pageSize: Math.max(1, MAX_CHANGES),
    fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,trashed))',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    restrictToMyDrive: false
  });

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
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { ranges: clears }
    });
  }
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });
  }
  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends }
    });
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
    fetchedChanges,
    clearedRows: clears.length,
    updatedCells: updates.length,
    appendedRows: appends.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
