import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const ARCHIVE_FOLDER_ID = process.env.ARCHIVE_FOLDER_ID || '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SHEET_DELETE_ARCHIVE_SYNC.md');
const MAX_MOVES = Number.parseInt(process.env.MICRO_SHEET_DELETE_MAX_MOVES || '30', 10);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function getSheetValues(range: string): Promise<string[][]> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return (r.data.values || []) as string[][];
}

async function moveFileToArchive(fileId: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const meta = await drive.files.get({
      fileId,
      fields: 'id,parents',
      supportsAllDrives: true
    });
    const parents = (meta.data.parents || []).join(',');
    await drive.files.update({
      fileId,
      addParents: ARCHIVE_FOLDER_ID,
      removeParents: parents,
      requestBody: {},
      supportsAllDrives: true,
      fields: 'id'
    });
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
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'sync_state!A:Z'
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'sync_state!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: syncValues }
  });

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

