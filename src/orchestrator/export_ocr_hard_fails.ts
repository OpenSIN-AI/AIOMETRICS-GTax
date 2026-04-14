import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

type FailCacheEntry = {
  attempts: number;
  lastReason: string;
  lastSeen: string;
  originalName: string;
};

type BelegRow = {
  rowNumber: number;
  driveFileId: string;
  originalName: string;
  mimeType: string;
  category: string;
  analyzedAt: string;
  movedAt: string;
  sourceFolderId: string;
  targetFolderId: string;
  fileUrl: string;
};

type FolderMeta = {
  id: string;
  name: string;
  parents: string[];
};

type OutputRow = {
  generatedAt: string;
  priorityRank: number;
  priorityBucket: string;
  priorityScore: number;
  manualStatus: string;
  year: string;
  flow: string;
  driveFileId: string;
  originalName: string;
  reason: string;
  attempts: number;
  lastSeen: string;
  mimeType: string;
  sheetRow: number;
  targetFolderId: string;
  targetFolderName: string;
  targetFolderPath: string;
  sourceFolderId: string;
  sourceFolderName: string;
  sourceFolderPath: string;
  fileUrl: string;
};

const SPREADSHEET_ID = String(process.env.GOOGLE_SHEET_ID || '').trim();
const CREDENTIALS_PATH = String(process.env.GOOGLE_CREDENTIALS_PATH || '').trim();
const TAB_NAME = String(process.env.OCR_HARD_FAILS_TAB || 'OCR_HARD_FAILS').trim();
const FAIL_CACHE_PATH = String(
  process.env.FREE_OCR_FAIL_CACHE_PATH || path.join(process.cwd(), 'docs', 'FREE_OCR_BACKFILL_FAIL_CACHE.json')
).trim();
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.OCR_HARD_FAILS_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.OCR_HARD_FAILS_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.OCR_HARD_FAILS_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.OCR_HARD_FAILS_API_RETRY_MAX_MS, 15000);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'OCR_HARD_FAILS_EXPORT.md');

const auth = new JWT({
  keyFile: CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return await withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'export_ocr_hard_fails'
  });
}

function loadFailCache(): Map<string, FailCacheEntry> {
  if (!FAIL_CACHE_PATH || !fs.existsSync(FAIL_CACHE_PATH)) {
    throw new Error(`Fail cache not found: ${FAIL_CACHE_PATH}`);
  }
  const raw = fs.readFileSync(FAIL_CACHE_PATH, 'utf8');
  if (!raw.trim()) return new Map();
  const parsed = JSON.parse(raw) as Record<string, Partial<FailCacheEntry>>;
  const out = new Map<string, FailCacheEntry>();
  for (const [driveFileId, value] of Object.entries(parsed || {})) {
    const attempts = Math.max(0, Number.parseInt(String(value?.attempts || 0), 10) || 0);
    if (!driveFileId || attempts <= 0) continue;
    out.set(driveFileId, {
      attempts,
      lastReason: String(value?.lastReason || ''),
      lastSeen: String(value?.lastSeen || ''),
      originalName: String(value?.originalName || '')
    });
  }
  return out;
}

function toHeaderIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < header.length; i++) {
    map.set(String(header[i] || '').trim(), i);
  }
  return map;
}

async function readBelegeRows(): Promise<Map<string, BelegRow>> {
  const response = await withApiRetry(
    'sheets.values.get.belege',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1:AZ'
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  const values = (response.data.values || []) as string[][];
  const header = values[0] || [];
  const idx = toHeaderIndex(header);
  const iDrive = idx.get('drive_file_id') ?? -1;
  if (iDrive < 0) throw new Error('belege column drive_file_id missing');

  const iOriginalName = idx.get('original_name') ?? -1;
  const iMime = idx.get('mime_type') ?? -1;
  const iCategory = idx.get('category') ?? -1;
  const iAnalyzedAt = idx.get('analyzed_at') ?? -1;
  const iMovedAt = idx.get('moved_at') ?? -1;
  const iSourceFolderId = idx.get('source_folder_id') ?? -1;
  const iTargetFolderId = idx.get('target_folder_id') ?? -1;
  const iFileUrl = idx.get('file_url') ?? -1;

  const out = new Map<string, BelegRow>();
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const driveFileId = String(row[iDrive] || '').trim();
    if (!driveFileId) continue;
    out.set(driveFileId, {
      rowNumber: i + 1,
      driveFileId,
      originalName: iOriginalName >= 0 ? String(row[iOriginalName] || '') : '',
      mimeType: iMime >= 0 ? String(row[iMime] || '') : '',
      category: iCategory >= 0 ? String(row[iCategory] || '') : '',
      analyzedAt: iAnalyzedAt >= 0 ? String(row[iAnalyzedAt] || '') : '',
      movedAt: iMovedAt >= 0 ? String(row[iMovedAt] || '') : '',
      sourceFolderId: iSourceFolderId >= 0 ? String(row[iSourceFolderId] || '').trim() : '',
      targetFolderId: iTargetFolderId >= 0 ? String(row[iTargetFolderId] || '').trim() : '',
      fileUrl: iFileUrl >= 0 ? String(row[iFileUrl] || '') : ''
    });
  }
  return out;
}

function yearWeight(year: string): number {
  switch (year) {
    case '2026': return 500;
    case '2025': return 460;
    case '2024': return 420;
    case '2023': return 380;
    case '2022': return 340;
    default: return 280;
  }
}

function flowWeight(flow: string): number {
  if (flow === 'Einnahmen') return 80;
  if (flow === 'Ausgaben') return 40;
  return 10;
}

function reasonWeight(reason: string): number {
  const lower = reason.toLowerCase();
  if (lower.startsWith('error:')) return 45;
  if (lower.includes('timeout')) return 40;
  if (lower.includes('text_too_short')) return 25;
  return 15;
}

function toPriorityBucket(score: number): string {
  if (score >= 560) return 'P1';
  if (score >= 500) return 'P2';
  if (score >= 440) return 'P3';
  return 'P4';
}

function deriveYear(flowPath: string, fallbackProbe: string): string {
  const fromPath = flowPath.match(/\b(20\d{2})\b/);
  if (fromPath?.[1]) return fromPath[1];
  const fromFallback = fallbackProbe.match(/\b(20\d{2})\b/);
  if (fromFallback?.[1]) return fromFallback[1];
  return '0000';
}

function deriveFlow(pathProbe: string, category: string): string {
  const probe = `${pathProbe}\n${category}`.toLowerCase();
  if (probe.includes('einnahmen')) return 'Einnahmen';
  if (probe.includes('ausgaben')) return 'Ausgaben';
  if (probe.includes('einnahme')) return 'Einnahmen';
  if (probe.includes('ausgabe')) return 'Ausgaben';
  return 'Unklar';
}

async function getFolderMeta(folderId: string, cache: Map<string, FolderMeta | null>): Promise<FolderMeta | null> {
  if (!folderId) return null;
  if (cache.has(folderId)) return cache.get(folderId) || null;
  try {
    const response = await withApiRetry(
      `drive.files.get.folder.${folderId}`,
      () => drive.files.get({
        fileId: folderId,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: true
      }, { timeout: REQUEST_TIMEOUT_MS })
    );
    const file = response.data;
    if (!file?.id || file.mimeType !== 'application/vnd.google-apps.folder') {
      cache.set(folderId, null);
      return null;
    }
    const meta: FolderMeta = {
      id: String(file.id),
      name: String(file.name || file.id),
      parents: (file.parents || []).map((id) => String(id || '').trim()).filter(Boolean)
    };
    cache.set(folderId, meta);
    return meta;
  } catch {
    cache.set(folderId, null);
    return null;
  }
}

async function resolveFolderPath(folderId: string, cache: Map<string, FolderMeta | null>, pathCache: Map<string, string>): Promise<string> {
  if (!folderId) return '';
  if (pathCache.has(folderId)) return String(pathCache.get(folderId) || '');
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = folderId;
  let depth = 0;
  while (currentId && !visited.has(currentId) && depth < 12) {
    depth++;
    visited.add(currentId);
    const meta = await getFolderMeta(currentId, cache);
    if (!meta) {
      chain.push(currentId);
      break;
    }
    chain.push(meta.name);
    currentId = String(meta.parents[0] || '').trim();
  }
  const resolved = chain.reverse().join('/');
  pathCache.set(folderId, resolved);
  return resolved;
}

async function ensureSheet(tabName: string): Promise<number> {
  const spreadsheet = await withApiRetry(
    'sheets.spreadsheets.get',
    () => sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  const found = (spreadsheet.data.sheets || []).find((s) => s.properties?.title === tabName);
  if (typeof found?.properties?.sheetId === 'number') return found.properties.sheetId;

  const create = await withApiRetry(
    'sheets.spreadsheets.batchUpdate.addSheet',
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }]
      }
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  const createdSheetId = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof createdSheetId !== 'number') throw new Error(`Failed to create sheet ${tabName}`);
  return createdSheetId;
}

async function writeOutput(tabName: string, sheetId: number, rows: OutputRow[]): Promise<void> {
  const header = [
    'generated_at',
    'priority_rank',
    'priority_bucket',
    'priority_score',
    'manual_status',
    'year',
    'flow',
    'drive_file_id',
    'original_name',
    'reason',
    'attempts',
    'last_seen',
    'mime_type',
    'sheet_row',
    'target_folder_id',
    'target_folder_name',
    'target_folder_path',
    'source_folder_id',
    'source_folder_name',
    'source_folder_path',
    'file_url'
  ];

  const matrix = [
    header,
    ...rows.map((row) => [
      row.generatedAt,
      String(row.priorityRank),
      row.priorityBucket,
      String(row.priorityScore),
      row.manualStatus,
      row.year,
      row.flow,
      row.driveFileId,
      row.originalName,
      row.reason,
      String(row.attempts),
      row.lastSeen,
      row.mimeType,
      String(row.sheetRow || ''),
      row.targetFolderId,
      row.targetFolderName,
      row.targetFolderPath,
      row.sourceFolderId,
      row.sourceFolderName,
      row.sourceFolderPath,
      row.fileUrl
    ])
  ];

  await withApiRetry(
    'sheets.values.clear',
    () => sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A:Z`
    }, { timeout: REQUEST_TIMEOUT_MS })
  );

  await withApiRetry(
    'sheets.values.update',
    () => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: matrix }
    }, { timeout: REQUEST_TIMEOUT_MS })
  );

  await withApiRetry(
    'sheets.spreadsheets.batchUpdate.layout',
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          },
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: Math.max(1, matrix.length),
                  startColumnIndex: 0,
                  endColumnIndex: header.length
                }
              }
            }
          }
        ]
      }
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
}

function writeReport(rows: OutputRow[], belegeMisses: number, uniqueFolders: number): void {
  const generatedAt = new Date().toISOString();
  const bucketCount = new Map<string, number>();
  for (const row of rows) {
    bucketCount.set(row.priorityBucket, (bucketCount.get(row.priorityBucket) || 0) + 1);
  }

  const lines: string[] = [];
  lines.push('# OCR Hard Fails Export');
  lines.push('');
  lines.push(`- Timestamp: ${generatedAt}`);
  lines.push(`- Spreadsheet: ${SPREADSHEET_ID}`);
  lines.push(`- Tab: ${TAB_NAME}`);
  lines.push(`- Fail cache path: ${FAIL_CACHE_PATH}`);
  lines.push(`- Rows exported: ${rows.length}`);
  lines.push(`- Missing belege rows: ${belegeMisses}`);
  lines.push(`- Unique folders resolved: ${uniqueFolders}`);
  lines.push('');
  lines.push('## Priority Buckets');
  lines.push('');
  lines.push('| Bucket | Count |');
  lines.push('|---|---:|');
  for (const bucket of ['P1', 'P2', 'P3', 'P4']) {
    lines.push(`| ${bucket} | ${bucketCount.get(bucket) || 0} |`);
  }
  lines.push('');
  lines.push('## Top 25');
  lines.push('');
  lines.push('| Rank | Bucket | Score | Year | Flow | drive_file_id | Reason |');
  lines.push('|---:|---|---:|---|---|---|---|');
  for (const row of rows.slice(0, 25)) {
    lines.push(`| ${row.priorityRank} | ${row.priorityBucket} | ${row.priorityScore} | ${row.year} | ${row.flow} | ${row.driveFileId} | ${row.reason.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  if (!CREDENTIALS_PATH) throw new Error('Missing GOOGLE_CREDENTIALS_PATH');

  const failCache = loadFailCache();
  const belegeById = await readBelegeRows();
  const folderCache = new Map<string, FolderMeta | null>();
  const folderPathCache = new Map<string, string>();
  const generatedAt = new Date().toISOString();

  let belegeMisses = 0;
  const output: OutputRow[] = [];
  const uniqueFolderIds = new Set<string>();

  for (const [driveFileId, fail] of failCache.entries()) {
    const beleg = belegeById.get(driveFileId);
    if (!beleg) belegeMisses++;

    const targetFolderId = String(beleg?.targetFolderId || '').trim();
    const sourceFolderId = String(beleg?.sourceFolderId || '').trim();
    if (targetFolderId) uniqueFolderIds.add(targetFolderId);
    if (sourceFolderId) uniqueFolderIds.add(sourceFolderId);

    const targetPath = targetFolderId ? await resolveFolderPath(targetFolderId, folderCache, folderPathCache) : '';
    const sourcePath = sourceFolderId ? await resolveFolderPath(sourceFolderId, folderCache, folderPathCache) : '';
    const targetName = targetPath.split('/').filter(Boolean).slice(-1)[0] || '';
    const sourceName = sourcePath.split('/').filter(Boolean).slice(-1)[0] || '';

    const flowProbe = `${targetPath}\n${sourcePath}\n${beleg?.category || ''}`;
    const fallbackProbe = `${beleg?.originalName || ''}\n${beleg?.analyzedAt || ''}\n${beleg?.movedAt || ''}`;
    const year = deriveYear(flowProbe, fallbackProbe);
    const flow = deriveFlow(flowProbe, String(beleg?.category || ''));
    const reason = String(fail.lastReason || 'unknown');
    const attempts = Math.max(1, Number.parseInt(String(fail.attempts || 1), 10) || 1);
    const score = yearWeight(year) + flowWeight(flow) + reasonWeight(reason) + Math.min(attempts, 5) * 2;

    output.push({
      generatedAt,
      priorityRank: 0,
      priorityBucket: toPriorityBucket(score),
      priorityScore: score,
      manualStatus: 'OPEN',
      year,
      flow,
      driveFileId,
      originalName: String(beleg?.originalName || fail.originalName || ''),
      reason,
      attempts,
      lastSeen: String(fail.lastSeen || ''),
      mimeType: String(beleg?.mimeType || ''),
      sheetRow: Number(beleg?.rowNumber || 0),
      targetFolderId,
      targetFolderName: targetName,
      targetFolderPath: targetPath,
      sourceFolderId,
      sourceFolderName: sourceName,
      sourceFolderPath: sourcePath,
      fileUrl: String(beleg?.fileUrl || '')
    });
  }

  output.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.year !== a.year) return b.year.localeCompare(a.year);
    if (a.flow !== b.flow) return a.flow.localeCompare(b.flow);
    return a.driveFileId.localeCompare(b.driveFileId);
  });
  for (let i = 0; i < output.length; i++) {
    output[i].priorityRank = i + 1;
  }

  const sheetId = await ensureSheet(TAB_NAME);
  await writeOutput(TAB_NAME, sheetId, output);
  writeReport(output, belegeMisses, uniqueFolderIds.size);

  console.log(JSON.stringify({
    status: 'ok',
    spreadsheetId: SPREADSHEET_ID,
    tabName: TAB_NAME,
    rowCount: output.length,
    missingBelegeRows: belegeMisses,
    uniqueFolderIds: uniqueFolderIds.size,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('export_ocr_hard_fails', main).catch((error) => {
  console.error(error);
  process.exit(1);
});

