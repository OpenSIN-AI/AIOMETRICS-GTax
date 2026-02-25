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

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  md5Checksum: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  parentId: string;
  path: string;
}

type DbRow = Record<string, string>;
type BelegeRow = Record<string, string>;

interface YearSheetRow {
  driveFileId: string;
  rowNumber: number;
  lieferant: string;
  rechnungsnr: string;
  datum: string;
  brutto: string;
  dateiname: string;
  mwst7: string;
  mwst0: string;
}

interface Hit {
  fileId: string;
  name: string;
  reason: string;
  supplier: string;
  invoiceNo: string;
  date: string;
  gross: string;
  path: string;
}

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const TARGET_YEAR = (process.env.AUDIT_YEAR || '2023').trim();
const REPORT_PATH = path.join(process.cwd(), 'docs', `AUDIT_${TARGET_YEAR}_STRICT.md`);

const PRIVATE_KEYWORDS = [
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
  'getranke hoffmann',
  'getraenke hoffmann',
  'woolworth',
  'eplus',
  'handykarte',
  'vattenfall',
  'strom',
  'hdi',
  'tierfutter',
  'drogerie',
  'lebensmittel',
  'obst',
  'gemuese',
  'gemüse',
  'salat',
  'cappuccino',
  'lucky strike',
  'lucky red',
  'lucky straight',
  'bier',
  'zigarette',
  'tabak',
  'myplace'
];

const ARCHIVE_KEYWORDS = [
  'miete',
  'hausverwaltung',
  'behörde',
  'behoerde',
  'finanzamt',
  'aok',
  'sbk',
  'arag',
  'bescheid',
  'mitteilung',
  'übertragungsprotokoll',
  'uebertragungsprotokoll',
  'behördengebühr',
  'behoerdengebuehr'
];

const CONFIRMATION_KEYWORDS = [
  'bestellbestätigung',
  'bestellbestaetigung',
  'bestellung',
  'lieferbestätigung',
  'lieferbestaetigung',
  'kaufbestätigung',
  'kaufbestaetigung',
  'referenz-nr',
  'referenznr',
  'order confirmation',
  'order number',
  'order no',
  'shipping confirmation',
  'purchase confirmation'
];

const INVOICE_KEYWORDS = [
  'rechnung',
  'invoice',
  'quittung',
  'beleg'
];

const FUEL_KEYWORDS = [
  'kraftstoff',
  'benzin',
  'diesel',
  'super e5',
  'super e10',
  'tankstelle',
  'liter'
];

const PRIVATE_ITEM_KEYWORDS = [
  'zigarette',
  'tabak',
  'bier',
  'obst',
  'gemuese',
  'gemüse',
  'salat',
  'cappuccino',
  'tierfutter',
  'drogerie',
  'lebensmittel',
  'lucky strike',
  'lucky red',
  'lucky straight'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
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

function normalizeProbe(values: string[]): string {
  return values.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function inferDateFromName(name: string): string {
  const value = name || '';
  const iso = value.match(/\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/);
  if (iso) {
    const mm = iso[2].padStart(2, '0');
    const dd = iso[3].padStart(2, '0');
    return `${iso[1]}-${mm}-${dd}`;
  }
  const dmy = value.match(/\b(\d{1,2})[.\-_](\d{1,2})[.\-_](20\d{2})\b/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return '';
}

function dateFromDriveTimestamp(value: string): string {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDate(value: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const dmy = raw.match(/\b(\d{1,2})[-./](\d{1,2})[-./](20\d{2})\b/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return dateFromDriveTimestamp(raw);
}

function inferYearFromText(rawText: string): string {
  const text = rawText || '';
  if (!text) return '';
  const matches = text.match(/\b20(2[2-9]|3[0-1])\b/g) || [];
  if (matches.length === 0) return '';
  const counts = new Map<string, number>();
  for (const y of matches) counts.set(y, (counts.get(y) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] || '';
}

function inferDocumentYear(file: DriveFile, db: DbRow | undefined, beleg: BelegeRow | undefined): string {
  const dbDateYear = normalizeDate(db?.belegdatum || '').slice(0, 4);
  if (dbDateYear) return dbDateYear;
  const fileDateYear = inferDateFromName(file.name).slice(0, 4);
  if (fileDateYear) return fileDateYear;
  const nameDateYear = inferDateFromName(beleg?.original_name || '').slice(0, 4);
  if (nameDateYear) return nameDateYear;
  return inferYearFromText([
    db?.dateiname_original || '',
    beleg?.original_name || '',
    (beleg?.extracted_text || '').slice(0, 5000),
    (beleg?.ocr_text || '').slice(0, 5000)
  ].join('\n'));
}

function hasConfirmationNoInvoice(probe: string): boolean {
  const hasConfirmation = CONFIRMATION_KEYWORDS.some((k) => probe.includes(k));
  const hasInvoice = INVOICE_KEYWORDS.some((k) => probe.includes(k));
  return hasConfirmation && !hasInvoice;
}

function desiredFlowFromSignals(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined,
  currentFlow: Flow
): Flow {
  const belegart = (db?.belegart || '').toLowerCase();

  const probe = normalizeProbe([
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    db?.belegnr || '',
    db?.hinweis || '',
    db?.steuerkategorie || '',
    beleg?.original_name || '',
    beleg?.category || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ]);

  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const salesPattern = /abschlagsrechnung|abschlagszahlung|schlussrechnung|teilrechnung|rechnungsplan|zahlung nach vertragsabschluss/.test(probe);
  const offerPattern = /angebot|pv anlage|inbetriebnahme|ac installation/.test(probe);
  const invoiceNoPattern = /\b\d{4}\.\d+\.\d+\b/.test(probe);
  const expensePattern = /ausgabe|tankstelle|kraftstoff|diesel|benzin|kassenbon|quittung|obi|bauhaus|hornbach|hellweg|lieferando|wolt|rewe|edeka|lidl|flink|myplace|miete|versicherung|strom|vattenfall/.test(probe);
  const gross = parseAmount(db?.brutto_gesamt || '');
  const hasInvoiceWord = /rechnung|invoice/.test(probe);
  const strongIncomeEvidence = salesPattern || (ownBusiness && (offerPattern || hasInvoiceWord || invoiceNoPattern));

  let incomeScore = 0;
  let expenseScore = 0;
  if (belegart.includes('einnahme')) incomeScore += 1;
  if (belegart.includes('ausgabe')) expenseScore += 1;
  if (salesPattern) incomeScore += 4;
  if (ownBusiness && offerPattern) incomeScore += 3;
  if (ownBusiness && invoiceNoPattern) incomeScore += 2;
  if (ownBusiness && hasInvoiceWord) incomeScore += 2;
  if (expensePattern) expenseScore += 4;
  if (FUEL_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (PRIVATE_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (ARCHIVE_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (gross <= 0 && !strongIncomeEvidence) incomeScore -= 1;

  if (incomeScore >= expenseScore + 2 && strongIncomeEvidence) return 'Einnahmen';
  if (expenseScore >= incomeScore + 2) return 'Ausgaben';
  if (currentFlow === 'Einnahmen' && incomeScore >= expenseScore) return 'Einnahmen';
  if (currentFlow === 'Ausgaben' && expenseScore >= incomeScore) return 'Ausgaben';
  return currentFlow;
}

function toBusinessKey(dbRow: DbRow | undefined): string {
  if (!dbRow) return '';
  const supplier = (dbRow.lieferant || '').trim().toLowerCase();
  const invoiceNo = (dbRow.belegnr || '').trim().toLowerCase();
  const date = normalizeDate(dbRow.belegdatum || '');
  const gross = parseAmount(dbRow.brutto_gesamt || '');
  if (!supplier || !date || gross <= 0) return '';
  if (invoiceNo) return `${supplier}|${invoiceNo}|${date}|${gross.toFixed(2)}`;
  return `${supplier}|${date}|${gross.toFixed(2)}`;
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
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
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,webViewLink)',
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

async function findFolderByName(
  driveApi: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<FolderNode | null> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const response = await runWithRateLimitRetry(
    () => driveApi.files.list({
      q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    }),
    `findFolderByName.${parentId}.${name}`
  );
  const folder = (response.data.files || [])[0];
  if (!folder?.id || !folder?.name) return null;
  return { id: folder.id, name: folder.name };
}

async function listFilesRecursive(
  driveApi: drive_v3.Drive,
  folderId: string,
  pathPrefix: string
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: Array<{ id: string; path: string }> = [{ id: folderId, path: pathPrefix }];
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
          mimeType: child.mimeType || '',
          size: Number.parseInt(child.size || '0', 10),
          md5Checksum: child.md5Checksum || '',
          createdTime: child.createdTime || '',
          modifiedTime: child.modifiedTime || '',
          webViewLink: child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
          parentId: child.parents?.[0] || current.id,
          path: `${current.path}/${childName}`
        });
      }
    }
  }
  return out;
}

async function readTableRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<Record<string, string>[]> {
  const response = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }),
    `readTableRows.${range}`
  );
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0].map((h) => String(h || '').trim());
  const out: Record<string, string>[] = [];
  for (const row of values.slice(1)) {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = String(row[i] || '');
    });
    if (Object.values(obj).some((v) => v !== '')) out.push(obj);
  }
  return out;
}

async function readYearRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string
): Promise<YearSheetRow[]> {
  const response = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.get({ spreadsheetId, range: tab }),
    `readYearRows.${tab}`
  );
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);
  const iDrive = idx('drive_file_id');
  const iLieferant = idx('Lieferant');
  const iRechnungsnr = idx('Rechnungsnr');
  const iDatum = idx('Datum');
  const iBrutto = idx('Betrag_Brutto');
  const iDateiname = idx('Dateiname');
  const iMwst7 = idx('mwst_7_betrag');
  const iMwst0 = idx('mwst_0_betrag');
  return values.slice(1).map((row, i) => ({
    driveFileId: row[iDrive] || '',
    rowNumber: i + 2,
    lieferant: row[iLieferant] || '',
    rechnungsnr: row[iRechnungsnr] || '',
    datum: row[iDatum] || '',
    brutto: row[iBrutto] || '',
    dateiname: row[iDateiname] || '',
    mwst7: row[iMwst7] || '',
    mwst0: row[iMwst0] || ''
  })).filter((r) => Boolean(r.driveFileId));
}

function mkHit(file: DriveFile, db: DbRow | undefined, reason: string): Hit {
  return {
    fileId: file.id,
    name: file.name,
    reason,
    supplier: db?.lieferant || '',
    invoiceNo: db?.belegnr || '',
    date: db?.belegdatum || '',
    gross: db?.brutto_gesamt || '',
    path: file.path
  };
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  });
  const driveApi = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const yearFolder = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, TARGET_YEAR);
  if (!yearFolder) throw new Error(`${TARGET_YEAR} folder not found`);
  const incomeFolder = await findFolderByName(driveApi, yearFolder.id, `Einnahmen_${TARGET_YEAR}`);
  const expenseFolder = await findFolderByName(driveApi, yearFolder.id, `Ausgaben_${TARGET_YEAR}`);
  if (!incomeFolder || !expenseFolder) throw new Error(`Einnahmen_${TARGET_YEAR} or Ausgaben_${TARGET_YEAR} folder missing`);

  const [incomeDriveFiles, expenseDriveFiles, dbRows, belegRows, incomeSheetRows, expenseSheetRows] = await Promise.all([
    listFilesRecursive(driveApi, incomeFolder.id, `${TARGET_YEAR}/Einnahmen_${TARGET_YEAR}`),
    listFilesRecursive(driveApi, expenseFolder.id, `${TARGET_YEAR}/Ausgaben_${TARGET_YEAR}`),
    readTableRows(sheetsApi, spreadsheetId, 'Buchhaltung_DB'),
    readTableRows(sheetsApi, spreadsheetId, 'belege'),
    readYearRows(sheetsApi, spreadsheetId, `Einnahmen_${TARGET_YEAR}`),
    readYearRows(sheetsApi, spreadsheetId, `Ausgaben_${TARGET_YEAR}`)
  ]);

  const dbByDriveId = new Map<string, DbRow>();
  for (const row of dbRows) {
    const id = row.drive_file_id || '';
    if (id && !dbByDriveId.has(id)) dbByDriveId.set(id, row);
  }
  const belegeByDriveId = new Map<string, BelegeRow>();
  for (const row of belegRows) {
    const id = row.drive_file_id || '';
    if (id && !belegeByDriveId.has(id)) belegeByDriveId.set(id, row);
  }

  const incomeDriveIds = new Set(incomeDriveFiles.map((f) => f.id));
  const expenseDriveIds = new Set(expenseDriveFiles.map((f) => f.id));
  const incomeSheetIds = new Set(incomeSheetRows.map((r) => r.driveFileId));
  const expenseSheetIds = new Set(expenseSheetRows.map((r) => r.driveFileId));

  const incomeDriveOnly = incomeDriveFiles.filter((f) => !incomeSheetIds.has(f.id));
  const incomeSheetOnly = incomeSheetRows.filter((r) => !incomeDriveIds.has(r.driveFileId));
  const expenseDriveOnly = expenseDriveFiles.filter((f) => !expenseSheetIds.has(f.id));
  const expenseSheetOnly = expenseSheetRows.filter((r) => !expenseDriveIds.has(r.driveFileId));

  const privateHits: Hit[] = [];
  const archiveHits: Hit[] = [];
  const confirmationHits: Hit[] = [];
  const incomeMisfiledHits: Hit[] = [];
  const vat7Hits: Hit[] = [];
  const vat0Hits: Hit[] = [];
  const yearMismatchHits: Hit[] = [];

  const byMd5 = new Map<string, DriveFile[]>();
  const byBusiness = new Map<string, DriveFile[]>();

  for (const file of expenseDriveFiles) {
    const db = dbByDriveId.get(file.id);
    const beleg = belegeByDriveId.get(file.id);
    const probe = normalizeProbe([
      file.name,
      db?.lieferant || '',
      db?.belegnr || '',
      db?.steuerkategorie || '',
      db?.hinweis || '',
      db?.belegart || '',
      db?.kunde || '',
      beleg?.original_name || '',
      beleg?.category || '',
      (beleg?.ocr_text || '').slice(0, 4000),
      (beleg?.extracted_text || '').slice(0, 4000)
    ]);
    const hasFuel = FUEL_KEYWORDS.some((k) => probe.includes(k));
    const hasPrivateItem = PRIVATE_ITEM_KEYWORDS.some((k) => probe.includes(k));

    if (!hasFuel && (PRIVATE_KEYWORDS.some((k) => probe.includes(k)) || hasPrivateItem)) {
      privateHits.push(mkHit(file, db, 'private_marker'));
    }
    if (ARCHIVE_KEYWORDS.some((k) => probe.includes(k))) {
      archiveHits.push(mkHit(file, db, 'archive_marker'));
    }
    if (hasConfirmationNoInvoice(probe)) {
      confirmationHits.push(mkHit(file, db, 'confirmation_without_invoice'));
    }
    if (desiredFlowFromSignals(file, db, beleg, 'Ausgaben') === 'Einnahmen') {
      incomeMisfiledHits.push(mkHit(file, db, 'looks_like_income'));
    }

    const vat7 = parseAmount(db?.mwst_7_betrag || '');
    const vat0 = parseAmount(db?.mwst_0_betrag || '');
    if (!hasFuel && vat7 > 0) vat7Hits.push(mkHit(file, db, 'mwst_7_present'));
    if (!hasFuel && vat0 > 0) vat0Hits.push(mkHit(file, db, 'mwst_0_present'));

    const inferredYear = inferDocumentYear(file, db, beleg);
    if (inferredYear && inferredYear !== TARGET_YEAR) {
      yearMismatchHits.push(mkHit(file, db, `year_mismatch_${inferredYear}`));
    }

    if (file.md5Checksum) {
      const key = `md5:${file.md5Checksum}`;
      const arr = byMd5.get(key) || [];
      arr.push(file);
      byMd5.set(key, arr);
    }
    const businessKey = toBusinessKey(db);
    if (businessKey) {
      const arr = byBusiness.get(businessKey) || [];
      arr.push(file);
      byBusiness.set(businessKey, arr);
    }
  }

  const duplicateMd5Groups = [...byMd5.values()].filter((g) => g.length > 1);
  const duplicateBusinessGroups = [...byBusiness.values()].filter((g) => g.length > 1);

  const report: string[] = [];
  report.push(`# AUDIT ${TARGET_YEAR} STRICT`);
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  report.push(`- Einnahmen Folder: ${incomeFolder.id}`);
  report.push(`- Ausgaben Folder: ${expenseFolder.id}`);
  report.push('');
  report.push('## Sync');
  report.push('');
  report.push(`- Einnahmen Drive: ${incomeDriveFiles.length} | Sheet: ${incomeSheetRows.length} | DriveOnly: ${incomeDriveOnly.length} | SheetOnly: ${incomeSheetOnly.length}`);
  report.push(`- Ausgaben Drive: ${expenseDriveFiles.length} | Sheet: ${expenseSheetRows.length} | DriveOnly: ${expenseDriveOnly.length} | SheetOnly: ${expenseSheetOnly.length}`);
  report.push('');
  report.push('## Ausgaben Verstöße (Drive-basiert)');
  report.push('');
  report.push(`- Private Marker: ${privateHits.length}`);
  report.push(`- Archiv Marker: ${archiveHits.length}`);
  report.push(`- Nur Bestell/Lieferbestätigung: ${confirmationHits.length}`);
  report.push(`- Einnahme-verdächtig (Zoe/Jeremy/Abschlagsrechnung): ${incomeMisfiledHits.length}`);
  report.push(`- MwSt 7% vorhanden: ${vat7Hits.length}`);
  report.push(`- MwSt 0% vorhanden: ${vat0Hits.length}`);
  report.push(`- Jahr != ${TARGET_YEAR}: ${yearMismatchHits.length}`);
  report.push(`- Duplikatgruppen md5: ${duplicateMd5Groups.length}`);
  report.push(`- Duplikatgruppen Business-Key: ${duplicateBusinessGroups.length}`);
  report.push('');

  const top = (title: string, hits: Hit[]): void => {
    if (hits.length === 0) return;
    report.push(`### ${title} (Top 100)`);
    report.push('');
    for (const hit of hits.slice(0, 100)) {
      report.push(`- ${hit.fileId} | ${hit.name} | ${hit.reason} | ${hit.supplier} | ${hit.date} | ${hit.gross}`);
    }
    report.push('');
  };

  top('Private Marker', privateHits);
  top('Archiv Marker', archiveHits);
  top('Bestell/Lieferbestätigungen', confirmationHits);
  top('Einnahme-verdächtig in Ausgaben', incomeMisfiledHits);
  top('MwSt 7%', vat7Hits);
  top('MwSt 0%', vat0Hits);
  top('Jahr-Mismatch', yearMismatchHits);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf8');

  const criticalViolations =
    incomeDriveOnly.length +
    incomeSheetOnly.length +
    expenseDriveOnly.length +
    expenseSheetOnly.length +
    privateHits.length +
    archiveHits.length +
    confirmationHits.length +
    incomeMisfiledHits.length +
    vat7Hits.length +
    vat0Hits.length +
    yearMismatchHits.length +
    duplicateMd5Groups.length +
    duplicateBusinessGroups.length;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    sync: {
      incomeDrive: incomeDriveFiles.length,
      incomeSheet: incomeSheetRows.length,
      incomeDriveOnly: incomeDriveOnly.length,
      incomeSheetOnly: incomeSheetOnly.length,
      expenseDrive: expenseDriveFiles.length,
      expenseSheet: expenseSheetRows.length,
      expenseDriveOnly: expenseDriveOnly.length,
      expenseSheetOnly: expenseSheetOnly.length
    },
    expenseViolations: {
      privateHits: privateHits.length,
      archiveHits: archiveHits.length,
      confirmationHits: confirmationHits.length,
      incomeMisfiledHits: incomeMisfiledHits.length,
      vat7Hits: vat7Hits.length,
      vat0Hits: vat0Hits.length,
      yearMismatchHits: yearMismatchHits.length,
      duplicateMd5Groups: duplicateMd5Groups.length,
      duplicateBusinessGroups: duplicateBusinessGroups.length
    },
    criticalViolations,
    zeroErrorStrict: criticalViolations === 0
  }, null, 2));
}

main().catch((error) => {
  console.error(`audit_${TARGET_YEAR}_strict failed:`, error);
  process.exit(1);
});
