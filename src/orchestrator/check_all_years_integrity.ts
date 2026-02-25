import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

type Flow = 'Einnahmen' | 'Ausgaben';

interface FolderNode {
  id: string;
  name: string;
}

interface DriveFileInfo {
  id: string;
  name: string;
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

interface FlowResult {
  year: string;
  flow: Flow;
  sheetTabExists: boolean;
  driveCount: number;
  sheetCount: number;
  driveOnly: number;
  sheetOnly: number;
  duplicateDriveIdsInSheet: number;
  potentialPrivateRows: number;
  potentialDuplicateBusinessKeys: number;
}

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const REPORT_PATH = path.join(process.cwd(), 'docs', 'CHECK_ALL_YEARS_DRIVE_SHEETS_SYNC.md');

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function normalizeText(value: string): string {
  return (value || '').trim().toLowerCase();
}

function parseAmount(value: string): number {
  const raw = (value || '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') && clean.includes('.')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBusinessKey(row: SheetRow): string {
  const supplier = normalizeText(row.lieferant);
  const invoiceNo = normalizeText(row.rechnungsnr);
  const date = normalizeText(row.datum);
  const amountNum = parseAmount(row.betragBrutto);
  const amount = amountNum > 0 ? amountNum.toFixed(2) : '';
  if (!supplier || !date || !amount) return '';
  if (!invoiceNo) return `${supplier}|${date}|${amount}`;
  return `${supplier}|${invoiceNo}|${date}|${amount}`;
}

function isPotentialPrivateRow(row: SheetRow): boolean {
  const probe = [
    row.lieferant,
    row.kategorie,
    row.status,
    row.dateiname
  ].join(' ').toLowerCase();

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

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === maxAttempts) throw error;
      const waitMs = attempt * 2500;
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

async function listFilesRecursive(driveApi: drive_v3.Drive, folderId: string): Promise<DriveFileInfo[]> {
  const out: DriveFileInfo[] = [];
  const queue: string[] = [folderId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const children = await listChildren(driveApi, current);
    for (const child of children) {
      const childId = child.id || '';
      const childName = child.name || childId;
      if (!childId) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') queue.push(childId);
      else out.push({ id: childId, name: childName });
    }
  }
  return out;
}

async function findFolderByName(
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
    `findFolderByName.${parentId}.${name}`
  );
  const first = (response.data.files || [])[0];
  if (!first?.id || !first?.name) return null;
  return { id: first.id, name: first.name };
}

async function readSheetRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string
): Promise<{ exists: boolean; rows: SheetRow[] }> {
  try {
    const response: any = await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: tabName
      }),
      `readSheetRows.${tabName}`
    );
    const values = response.data.values || [];
    if (values.length <= 1) return { exists: true, rows: [] };

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
    return { exists: true, rows: rows.filter((row) => Boolean(row.driveFileId)) };
  } catch (error: any) {
    const status = error?.response?.status || error?.code;
    const message = String(error?.response?.data?.error?.message || error?.message || '');
    if (status === 400 && message.toLowerCase().includes('unable to parse range')) {
      return { exists: false, rows: [] };
    }
    throw error;
  }
}

function evaluateFlow(year: string, flow: Flow, driveFiles: DriveFileInfo[], sheetRows: SheetRow[], sheetTabExists: boolean): FlowResult {
  const driveIds = new Set(driveFiles.map((file) => file.id));
  const sheetIds = new Set(sheetRows.map((row) => row.driveFileId));

  const driveOnly = driveFiles.filter((file) => !sheetIds.has(file.id)).length;
  const sheetOnly = sheetRows.filter((row) => !driveIds.has(row.driveFileId)).length;

  const rowsByDriveId = new Map<string, number>();
  for (const row of sheetRows) {
    rowsByDriveId.set(row.driveFileId, (rowsByDriveId.get(row.driveFileId) || 0) + 1);
  }
  const duplicateDriveIdsInSheet = Array.from(rowsByDriveId.values()).filter((count) => count > 1).length;
  const potentialPrivateRows = sheetRows.filter((row) => isPotentialPrivateRow(row)).length;

  const rowsByBusinessKey = new Map<string, number>();
  for (const row of sheetRows) {
    const key = toBusinessKey(row);
    if (!key) continue;
    rowsByBusinessKey.set(key, (rowsByBusinessKey.get(key) || 0) + 1);
  }
  const potentialDuplicateBusinessKeys = Array.from(rowsByBusinessKey.values()).filter((count) => count > 1).length;

  return {
    year,
    flow,
    sheetTabExists,
    driveCount: driveFiles.length,
    sheetCount: sheetRows.length,
    driveOnly,
    sheetOnly,
    duplicateDriveIdsInSheet,
    potentialPrivateRows,
    potentialDuplicateBusinessKeys
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

  const topLevel = await listChildren(driveApi, ACCOUNTING_ROOT_FOLDER_ID);
  const yearFolders = topLevel
    .filter((entry) => entry.mimeType === 'application/vnd.google-apps.folder')
    .filter((entry) => /^20\d{2}$/.test(entry.name || ''))
    .map((entry) => ({ id: entry.id || '', name: entry.name || '' }))
    .filter((entry) => Boolean(entry.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const results: FlowResult[] = [];

  for (const yearFolder of yearFolders) {
    const year = yearFolder.name;
    const incomeFolder = await findFolderByName(driveApi, yearFolder.id, `Einnahmen_${year}`);
    const expenseFolder = await findFolderByName(driveApi, yearFolder.id, `Ausgaben_${year}`);
    if (!incomeFolder || !expenseFolder) {
      results.push({
        year,
        flow: 'Einnahmen',
        sheetTabExists: false,
        driveCount: 0,
        sheetCount: 0,
        driveOnly: 0,
        sheetOnly: 0,
        duplicateDriveIdsInSheet: 0,
        potentialPrivateRows: 0,
        potentialDuplicateBusinessKeys: 0
      });
      results.push({
        year,
        flow: 'Ausgaben',
        sheetTabExists: false,
        driveCount: 0,
        sheetCount: 0,
        driveOnly: 0,
        sheetOnly: 0,
        duplicateDriveIdsInSheet: 0,
        potentialPrivateRows: 0,
        potentialDuplicateBusinessKeys: 0
      });
      continue;
    }

    const [incomeDrive, expenseDrive, incomeSheet, expenseSheet] = await Promise.all([
      listFilesRecursive(driveApi, incomeFolder.id),
      listFilesRecursive(driveApi, expenseFolder.id),
      readSheetRows(sheetsApi, spreadsheetId, `Einnahmen_${year}`),
      readSheetRows(sheetsApi, spreadsheetId, `Ausgaben_${year}`)
    ]);

    results.push(evaluateFlow(year, 'Einnahmen', incomeDrive, incomeSheet.rows, incomeSheet.exists));
    results.push(evaluateFlow(year, 'Ausgaben', expenseDrive, expenseSheet.rows, expenseSheet.exists));
  }

  const totals = results.reduce((acc, item) => {
    acc.driveCount += item.driveCount;
    acc.sheetCount += item.sheetCount;
    acc.driveOnly += item.driveOnly;
    acc.sheetOnly += item.sheetOnly;
    acc.duplicateDriveIdsInSheet += item.duplicateDriveIdsInSheet;
    acc.potentialPrivateRows += item.potentialPrivateRows;
    acc.potentialDuplicateBusinessKeys += item.potentialDuplicateBusinessKeys;
    return acc;
  }, {
    driveCount: 0,
    sheetCount: 0,
    driveOnly: 0,
    sheetOnly: 0,
    duplicateDriveIdsInSheet: 0,
    potentialPrivateRows: 0,
    potentialDuplicateBusinessKeys: 0
  });

  const zeroError =
    totals.driveOnly === 0 &&
    totals.sheetOnly === 0 &&
    totals.duplicateDriveIdsInSheet === 0 &&
    totals.potentialPrivateRows === 0 &&
    totals.potentialDuplicateBusinessKeys === 0;

  const lines: string[] = [];
  lines.push('# Gesamtcheck Alle Jahre (Drive vs Sheets)');
  lines.push('');
  lines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  lines.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  lines.push(`- Accounting Root: ${ACCOUNTING_ROOT_FOLDER_ID}`);
  lines.push(`- Jahre gefunden: ${yearFolders.map((y) => y.name).join(', ')}`);
  lines.push(`- Zero-Error gesamt: ${zeroError ? 'JA' : 'NEIN'}`);
  lines.push('');
  lines.push('| Jahr | Flow | Drive | Sheet | DriveOnly | SheetOnly | DupIDs | Privat | DupKeys | Tab |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const item of results) {
    lines.push(`| ${item.year} | ${item.flow} | ${item.driveCount} | ${item.sheetCount} | ${item.driveOnly} | ${item.sheetOnly} | ${item.duplicateDriveIdsInSheet} | ${item.potentialPrivateRows} | ${item.potentialDuplicateBusinessKeys} | ${item.sheetTabExists ? 'ok' : 'missing'} |`);
  }
  lines.push('');
  lines.push('## Summen');
  lines.push('');
  lines.push(`- Drive-Dateien: ${totals.driveCount}`);
  lines.push(`- Sheet-Zeilen: ${totals.sheetCount}`);
  lines.push(`- DriveOnly: ${totals.driveOnly}`);
  lines.push(`- SheetOnly: ${totals.sheetOnly}`);
  lines.push(`- Duplicate drive_file_id in Sheet: ${totals.duplicateDriveIdsInSheet}`);
  lines.push(`- Privatmarker: ${totals.potentialPrivateRows}`);
  lines.push(`- Duplikatkeys: ${totals.potentialDuplicateBusinessKeys}`);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    years: yearFolders.map((y) => y.name),
    totals,
    zeroError
  }, null, 2));
}

main().catch((error) => {
  console.error('check_all_years_integrity failed:', error);
  process.exit(1);
});
