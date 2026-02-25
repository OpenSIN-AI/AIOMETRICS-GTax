import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

type Flow = 'Einnahmen' | 'Ausgaben';

interface DriveFileInfo {
  id: string;
  name: string;
  folderPath: string;
}

interface SheetRow {
  driveFileId: string;
  lieferant: string;
  rechnungsnr: string;
  datum: string;
  betragBrutto: string;
  kategorie: string;
  status: string;
  dateiname: string;
  rowNumber: number;
}

interface FlowCheckResult {
  flow: Flow;
  driveCount: number;
  sheetCount: number;
  driveOnly: DriveFileInfo[];
  sheetOnly: SheetRow[];
  duplicateDriveIdsInSheet: Array<{ driveFileId: string; rows: number[] }>;
  potentialPrivateRows: SheetRow[];
  potentialDuplicateBusinessKeys: Array<{ key: string; rows: number[] }>;
}

interface FolderNode {
  id: string;
  name: string;
}

interface YearSummary {
  year: string;
  income: {
    driveCount: number;
    sheetCount: number;
    driveOnly: number;
    sheetOnly: number;
    duplicateDriveIdsInSheet: number;
    potentialPrivateRows: number;
    potentialDuplicateBusinessKeys: number;
  };
  expense: {
    driveCount: number;
    sheetCount: number;
    driveOnly: number;
    sheetOnly: number;
    duplicateDriveIdsInSheet: number;
    potentialPrivateRows: number;
    potentialDuplicateBusinessKeys: number;
  };
}

interface YearMismatchFiles {
  driveOnlyFullPath: string;
  sheetOnlyFullPath: string;
  duplicateFullPath: string;
}

const DEFAULT_ACCOUNTING_ROOT = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const REPORT_PATH = path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.md');
const REPORT_JSON_PATH = path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json');

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function normalizeText(value: string): string {
  return (value || '').trim().toLowerCase();
}

function toBusinessKey(row: SheetRow): string {
  const supplier = normalizeText(row.lieferant);
  const invoiceNo = normalizeText(row.rechnungsnr);
  const date = normalizeText(row.datum);
  const amount = normalizeText(row.betragBrutto);
  return `${supplier}|${invoiceNo}|${date}|${amount}`;
}

function isPotentialPrivateRow(row: SheetRow): boolean {
  const probe = [row.lieferant, row.kategorie, row.status, row.dateiname].join(' ').toLowerCase();
  const privateMarkers = [
    'private',
    'privat',
    'netflix',
    'apotheke',
    'apotheken',
    'wolt',
    'lieferando',
    'lidl',
    'rewe',
    'edeka',
    'flink',
    'zigare',
    'bier'
  ];
  return privateMarkers.some((marker) => probe.includes(marker));
}

function parseYears(input: string | undefined, discoveredYears: string[]): string[] {
  const raw = (input || '').split(',').map((x) => x.trim()).filter(Boolean);
  const valid = raw.filter((x) => /^20\d{2}$/.test(x));
  if (valid.length > 0) {
    return Array.from(new Set(valid)).sort();
  }
  if (discoveredYears.length > 0) {
    return discoveredYears;
  }
  return ['2023'];
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason =
        error?.errors?.[0]?.reason ||
        error?.response?.data?.error?.errors?.[0]?.reason ||
        '';
      const message = String(
        error?.response?.data?.error?.message ||
        error?.message ||
        ''
      );
      const rateLimited =
        status === 429 ||
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded' ||
        reason === 'quotaExceeded' ||
        message.includes('Quota exceeded');
      if (!rateLimited || attempt === maxAttempts) throw error;
      const waitMs = attempt * 5000;
      console.warn(`${op}: rate limited, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${op}: exhausted retries`);
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function discoverAvailableYears(driveApi: drive_v3.Drive, rootFolderId: string): Promise<string[]> {
  const topLevelFolders = await listChildren(driveApi, rootFolderId);
  return Array.from(
    new Set(
      topLevelFolders
        .filter((item) => item.mimeType === 'application/vnd.google-apps.folder')
        .map((item) => item.name || '')
        .filter((name) => /^20\d{2}$/.test(name))
    )
  ).sort();
}

async function findChildFolderByName(
  driveApi: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<FolderNode | null> {
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const response = await runWithRateLimitRetry(
    () => driveApi.files.list({
      q: `'${parentId}' in parents and name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    }),
    `findChildFolderByName.${parentId}.${name}`
  );
  const first = (response.data.files || [])[0];
  if (!first?.id || !first?.name) return null;
  return { id: first.id, name: first.name };
}

async function listFilesRecursiveWithPath(
  driveApi: drive_v3.Drive,
  folderId: string,
  folderPath: string
): Promise<DriveFileInfo[]> {
  const out: DriveFileInfo[] = [];
  const queue: Array<{ id: string; path: string }> = [{ id: folderId, path: folderPath }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);

    const children = await listChildren(driveApi, current.id);
    for (const child of children) {
      const childId = child.id || '';
      const childName = child.name || childId;
      if (!childId) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        queue.push({ id: childId, path: `${current.path}/${childName}` });
      } else {
        out.push({
          id: childId,
          name: childName,
          folderPath: current.path
        });
      }
    }
  }

  return out;
}

async function readSheetRows(
  sheetsApi: any,
  spreadsheetId: string,
  tabName: string
): Promise<SheetRow[]> {
  let response: any;
  try {
    response = await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: tabName
      }),
      `readSheetRows.${tabName}`
    );
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = Number(error?.response?.status || 0);
    const tabMissing =
      status === 400 &&
      (message.includes('Unable to parse range') || message.includes('Range'));
    if (tabMissing) {
      return [];
    }
    throw error;
  }
  const values = response.data.values || [];
  if (values.length <= 1) return [];

  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);

  const iDrive = idx('drive_file_id');
  const iLieferant = idx('Lieferant');
  const iRechnung = idx('Rechnungsnr');
  const iDatum = idx('Datum');
  const iBrutto = idx('Betrag_Brutto');
  const iKategorie = idx('Kategorie');
  const iStatus = idx('Status');
  const iDateiname = idx('Dateiname');

  const rows: SheetRow[] = [];
  values.slice(1).forEach((row: string[], i: number) => {
    rows.push({
      driveFileId: row[iDrive] || '',
      lieferant: row[iLieferant] || '',
      rechnungsnr: row[iRechnung] || '',
      datum: row[iDatum] || '',
      betragBrutto: row[iBrutto] || '',
      kategorie: row[iKategorie] || '',
      status: row[iStatus] || '',
      dateiname: row[iDateiname] || '',
      rowNumber: i + 2
    });
  });

  return rows.filter((row) => Boolean(row.driveFileId));
}

function checkFlow(flow: Flow, driveFiles: DriveFileInfo[], sheetRows: SheetRow[]): FlowCheckResult {
  const driveIds = new Set(driveFiles.map((file) => file.id));
  const sheetIds = new Set(sheetRows.map((row) => row.driveFileId));

  const driveOnly = driveFiles
    .filter((file) => !sheetIds.has(file.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sheetOnly = sheetRows
    .filter((row) => !driveIds.has(row.driveFileId))
    .sort((a, b) => a.driveFileId.localeCompare(b.driveFileId));

  const rowsByDriveId = new Map<string, number[]>();
  for (const row of sheetRows) {
    const arr = rowsByDriveId.get(row.driveFileId) || [];
    arr.push(row.rowNumber);
    rowsByDriveId.set(row.driveFileId, arr);
  }
  const duplicateDriveIdsInSheet = Array.from(rowsByDriveId.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([driveFileId, rows]) => ({ driveFileId, rows }))
    .sort((a, b) => a.driveFileId.localeCompare(b.driveFileId));

  const potentialPrivateRows = sheetRows.filter((row) => isPotentialPrivateRow(row));

  const rowsByBusinessKey = new Map<string, number[]>();
  for (const row of sheetRows) {
    const key = toBusinessKey(row);
    if (!key || key === '|||') continue;
    const list = rowsByBusinessKey.get(key) || [];
    list.push(row.rowNumber);
    rowsByBusinessKey.set(key, list);
  }
  const potentialDuplicateBusinessKeys = Array.from(rowsByBusinessKey.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);

  return {
    flow,
    driveCount: driveFiles.length,
    sheetCount: sheetRows.length,
    driveOnly,
    sheetOnly,
    duplicateDriveIdsInSheet,
    potentialPrivateRows,
    potentialDuplicateBusinessKeys
  };
}

function renderFlow(year: string, result: FlowCheckResult): string {
  const lines: string[] = [];
  lines.push(`## ${result.flow}_${year}`);
  lines.push('');
  lines.push(`- Drive-Dateien: ${result.driveCount}`);
  lines.push(`- Sheet-Zeilen: ${result.sheetCount}`);
  lines.push(`- Nur in Drive (fehlt im Sheet): ${result.driveOnly.length}`);
  lines.push(`- Nur im Sheet (fehlt in Drive): ${result.sheetOnly.length}`);
  lines.push(`- Doppelte drive_file_id im Sheet: ${result.duplicateDriveIdsInSheet.length}`);
  lines.push(`- Verdacht Privatbeleg im Sheet: ${result.potentialPrivateRows.length}`);
  lines.push(`- Verdacht Duplikat per Business-Key: ${result.potentialDuplicateBusinessKeys.length}`);
  lines.push('');

  if (result.driveOnly.length > 0) {
    lines.push('### Nur in Drive (Top 50)');
    lines.push('');
    for (const file of result.driveOnly.slice(0, 50)) {
      lines.push(`- ${file.id} | ${file.name} | ${file.folderPath}`);
    }
    lines.push('');
  }

  if (result.sheetOnly.length > 0) {
    lines.push('### Nur im Sheet (Top 50)');
    lines.push('');
    for (const row of result.sheetOnly.slice(0, 50)) {
      lines.push(`- Row ${row.rowNumber} | ${row.driveFileId} | ${row.dateiname} | ${row.lieferant} | ${row.betragBrutto}`);
    }
    lines.push('');
  }

  if (result.duplicateDriveIdsInSheet.length > 0) {
    lines.push('### Doppelte drive_file_id im Sheet (Top 50)');
    lines.push('');
    for (const item of result.duplicateDriveIdsInSheet.slice(0, 50)) {
      lines.push(`- ${item.driveFileId} | rows=${item.rows.join(',')}`);
    }
    lines.push('');
  }

  if (result.potentialPrivateRows.length > 0) {
    lines.push('### Verdacht Privatbeleg im Sheet (Top 50)');
    lines.push('');
    for (const row of result.potentialPrivateRows.slice(0, 50)) {
      lines.push(`- Row ${row.rowNumber} | ${row.driveFileId} | ${row.lieferant} | ${row.kategorie} | ${row.dateiname}`);
    }
    lines.push('');
  }

  if (result.potentialDuplicateBusinessKeys.length > 0) {
    lines.push('### Verdacht Duplikat Business-Key (Top 50)');
    lines.push('');
    for (const item of result.potentialDuplicateBusinessKeys.slice(0, 50)) {
      lines.push(`- ${item.key} | rows=${item.rows.join(',')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function checkYear(
  driveApi: drive_v3.Drive,
  sheetsApi: any,
  spreadsheetId: string,
  year: string
): Promise<{ summary: YearSummary; markdown: string; folderRefs: Record<string, string>; mismatchFiles: YearMismatchFiles }> {
  const root = await findChildFolderByName(driveApi, DEFAULT_ACCOUNTING_ROOT, year);
  const incomeFolder = root ? await findChildFolderByName(driveApi, root.id, `Einnahmen_${year}`) : null;
  const expenseFolder = root ? await findChildFolderByName(driveApi, root.id, `Ausgaben_${year}`) : null;

  const [incomeDriveFiles, expenseDriveFiles, incomeSheetRows, expenseSheetRows] = await Promise.all([
    incomeFolder ? listFilesRecursiveWithPath(driveApi, incomeFolder.id, `${year}/${incomeFolder.name}`) : Promise.resolve([]),
    expenseFolder ? listFilesRecursiveWithPath(driveApi, expenseFolder.id, `${year}/${expenseFolder.name}`) : Promise.resolve([]),
    readSheetRows(sheetsApi, spreadsheetId, `Einnahmen_${year}`),
    readSheetRows(sheetsApi, spreadsheetId, `Ausgaben_${year}`)
  ]);

  const incomeResult = checkFlow('Einnahmen', incomeDriveFiles, incomeSheetRows);
  const expenseResult = checkFlow('Ausgaben', expenseDriveFiles, expenseSheetRows);

  const summary: YearSummary = {
    year,
    income: {
      driveCount: incomeResult.driveCount,
      sheetCount: incomeResult.sheetCount,
      driveOnly: incomeResult.driveOnly.length,
      sheetOnly: incomeResult.sheetOnly.length,
      duplicateDriveIdsInSheet: incomeResult.duplicateDriveIdsInSheet.length,
      potentialPrivateRows: incomeResult.potentialPrivateRows.length,
      potentialDuplicateBusinessKeys: incomeResult.potentialDuplicateBusinessKeys.length
    },
    expense: {
      driveCount: expenseResult.driveCount,
      sheetCount: expenseResult.sheetCount,
      driveOnly: expenseResult.driveOnly.length,
      sheetOnly: expenseResult.sheetOnly.length,
      duplicateDriveIdsInSheet: expenseResult.duplicateDriveIdsInSheet.length,
      potentialPrivateRows: expenseResult.potentialPrivateRows.length,
      potentialDuplicateBusinessKeys: expenseResult.potentialDuplicateBusinessKeys.length
    }
  };

  const mismatchDir = path.join(process.cwd(), 'docs', 'mismatch');
  fs.mkdirSync(mismatchDir, { recursive: true });
  const driveOnlyFullPath = path.join(mismatchDir, `${year}_drive_only.json`);
  const sheetOnlyFullPath = path.join(mismatchDir, `${year}_sheet_only.json`);
  const duplicateFullPath = path.join(mismatchDir, `${year}_duplicate_drive_ids.json`);
  fs.writeFileSync(
    driveOnlyFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.driveOnly,
        expense: expenseResult.driveOnly
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    sheetOnlyFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.sheetOnly,
        expense: expenseResult.sheetOnly
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    duplicateFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.duplicateDriveIdsInSheet,
        expense: expenseResult.duplicateDriveIdsInSheet
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    summary,
    markdown: `${renderFlow(year, incomeResult)}\n${renderFlow(year, expenseResult)}`,
    folderRefs: {
      yearFolder: root?.id || '',
      incomeFolder: incomeFolder?.id || '',
      expenseFolder: expenseFolder?.id || ''
    },
    mismatchFiles: {
      driveOnlyFullPath,
      sheetOnlyFullPath,
      duplicateFullPath
    }
  };
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const driveApi = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const discoveredYears = await discoverAvailableYears(driveApi, DEFAULT_ACCOUNTING_ROOT);
  const years = parseYears(process.env.CHECK_YEARS, discoveredYears);

  const results = [] as Array<{ summary: YearSummary; markdown: string; folderRefs: Record<string, string>; mismatchFiles: YearMismatchFiles }>;
  for (const year of years) {
    results.push(await checkYear(driveApi, sheetsApi, spreadsheetId, year));
  }

  const reportLines: string[] = [];
  reportLines.push('# Letzter Konsistenzcheck (Drive vs Sheets)');
  reportLines.push('');
  reportLines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  reportLines.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  reportLines.push(`- Accounting Root: ${DEFAULT_ACCOUNTING_ROOT}`);
  reportLines.push(`- Geprüfte Jahre: ${years.join(', ')}`);
  reportLines.push('');

  for (const item of results) {
    reportLines.push(`### Ordner-Referenzen ${item.summary.year}`);
    reportLines.push('');
    reportLines.push(`- ${item.summary.year} Folder: ${item.folderRefs.yearFolder}`);
    reportLines.push(`- Einnahmen_${item.summary.year} Folder: ${item.folderRefs.incomeFolder}`);
    reportLines.push(`- Ausgaben_${item.summary.year} Folder: ${item.folderRefs.expenseFolder}`);
    reportLines.push('');
    reportLines.push(item.markdown);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');

  const summary = {
    timestamp: new Date().toISOString(),
    years,
    reportPath: REPORT_PATH,
    summaries: results.map((r) => r.summary),
    fullMismatchFiles: Object.fromEntries(
      results.map((r) => [r.summary.year, r.mismatchFiles])
    )
  };
  if (results.length === 1) {
    (summary as any).driveOnlyFullPath = results[0].mismatchFiles.driveOnlyFullPath;
    (summary as any).sheetOnlyFullPath = results[0].mismatchFiles.sheetOnlyFullPath;
    (summary as any).duplicateFullPath = results[0].mismatchFiles.duplicateFullPath;
  }

  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('check_2023_integrity failed:', error);
  process.exit(1);
});
