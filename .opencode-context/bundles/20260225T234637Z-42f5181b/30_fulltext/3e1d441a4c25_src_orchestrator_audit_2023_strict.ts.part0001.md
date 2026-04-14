# Context Fulltext

- source_path: src/orchestrator/audit_2023_strict.ts
- source_sha256: eb76d68e34b2785053166022308f253829cffe5d78830c538de068b2723a98ad
- chunk: 1/2

```text
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
  let pageToken: [REDACTED] | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: [REDACTED]
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = [REDACTED] || undefined;
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
    
```
