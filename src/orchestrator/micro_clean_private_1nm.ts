import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SOURCE_FOLDER_ID = '1NMlTFDw6SsyVEy5aimP0Awz3Tq3N1_vH'; // Ausgaben_2023
const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe'; // Private Belege
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_CLEAN_PRIVATE_1NM.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_CLEAN_PRIVATE_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_CLEAN_PRIVATE_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_CLEAN_PRIVATE_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_CLEAN_PRIVATE_API_RETRY_MAX_MS, 15000);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_clean_private_1nm'
  });
}

type FileMeta = drive_v3.Schema$File;

interface BelegeInfo {
  extractedText: string;
  ocrText: string;
  originalName: string;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const PRIVATE_MARKERS = [
  'lidl', 'rewe', 'edeka', 'flink', 'wolt', 'lieferando', 'netflix', 'apotheke',
  'tierfutter', 'drogerie', 'lebensmittel', 'zigarette', 'tabak', 'bier',
  'monster', 'nahkauf', 'pfand', 'berliner kindl', 'krombacher', 'coca cola',
  'salami', 'boerek', 'woolworth', 'getranke', 'getraenke'
];

const FUEL_MARKERS = [
  'kraftstoff', 'benzin', 'diesel', 'super e5', 'super e10', 'tankstelle', 'liter'
];

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const r = await withApiRetry(
      `drive.files.list.${folderId}`,
      () => drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,parents,webViewLink,createdTime,modifiedTime)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    out.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function readBelegeMap(): Promise<Map<string, BelegeInfo>> {
  const out = new Map<string, BelegeInfo>();
  if (!SPREADSHEET_ID) return out;
  const r = await withApiRetry(
    'sheets.values.get.belege',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1:AZ'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const rows = (r.data.values || []) as string[][];
  if (rows.length <= 1) return out;
  const h = rows[0];
  const iId = h.indexOf('drive_file_id');
  const iExt = h.indexOf('extracted_text');
  const iOcr = h.indexOf('ocr_text');
  const iName = h.indexOf('original_name');
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row[iId] || '').trim();
    if (!id) continue;
    out.set(id, {
      extractedText: String(row[iExt] || ''),
      ocrText: String(row[iOcr] || ''),
      originalName: String(row[iName] || '')
    });
  }
  return out;
}

async function moveToPrivate(file: FileMeta): Promise<void> {
  await withApiRetry(
    `drive.files.update.move_private.${file.id}`,
    () => drive.files.update({
      fileId: file.id as string,
      addParents: PRIVATE_FOLDER_ID,
      removeParents: SOURCE_FOLDER_ID,
      requestBody: {},
      fields: 'id',
      supportsAllDrives: true
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

async function main(): Promise<void> {
  const [files, belegeMap] = await Promise.all([
    listChildren(SOURCE_FOLDER_ID),
    readBelegeMap()
  ]);

  const moved: Array<{ id: string; name: string; reason: string }> = [];
  const kept: Array<{ id: string; name: string; reason: string }> = [];

  for (const f of files) {
    if (!f.id || !f.name) continue;
    const b = belegeMap.get(f.id);
    const probe = normalize([
      f.name,
      b?.originalName || '',
      b?.extractedText || '',
      b?.ocrText || ''
    ].join('\n'));

    const hasPrivate = containsAny(probe, PRIVATE_MARKERS);
    const hasFuel = containsAny(probe, FUEL_MARKERS);

    if (hasPrivate && !hasFuel) {
      await moveToPrivate(f);
      moved.push({ id: f.id, name: f.name, reason: 'private_marker_without_fuel' });
      continue;
    }
    kept.push({
      id: f.id,
      name: f.name,
      reason: hasPrivate && hasFuel ? 'mixed_private_and_fuel_kept_for_split' : 'no_private_marker'
    });
  }

  const lines: string[] = [];
  lines.push('# MICRO Worker Report: Clean Private in Ausgaben_2023 (1NM)');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Source: ${SOURCE_FOLDER_ID}`);
  lines.push(`- Target private: ${PRIVATE_FOLDER_ID}`);
  lines.push(`- Moved: ${moved.length}`);
  lines.push(`- Kept: ${kept.length}`);
  lines.push('');
  lines.push('## Moved');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const m of moved) lines.push(`| ${m.id} | ${m.reason} | ${m.name} |`);
  lines.push('');
  lines.push('## Kept (top 100)');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const k of kept.slice(0, 100)) lines.push(`| ${k.id} | ${k.reason} | ${k.name} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    sourceFolderId: SOURCE_FOLDER_ID,
    moved: moved.length,
    kept: kept.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_clean_private_1nm', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
