import * as dotenv from 'dotenv';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

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
interface ContentDoc {
  file: DriveFile;
  supplier: string;
  invoiceNo: string;
  date: string;
  gross: number;
  tokens: Set<string>;
}

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const ARCHIVE_FOLDER_ID = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const PAYMENT_PROOF_FOLDER_ID = '1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU';
const TARGET_YEAR = process.env.REPAIR_YEAR || '2023';
const STAGE_RESTORE_ARCHIVE = isTruthy(process.env.REPAIR_STAGE_RESTORE_ARCHIVE, true);
const STAGE_DEDUPE = isTruthy(process.env.REPAIR_STAGE_DEDUPE, true);
const STAGE_MOVE_POLICY = isTruthy(process.env.REPAIR_STAGE_MOVE_POLICY, true);
const STAGE_MOVE_FLOW = isTruthy(process.env.REPAIR_STAGE_MOVE_FLOW, true);
const STAGE_MOVE_YEAR = isTruthy(process.env.REPAIR_STAGE_MOVE_YEAR, true);
const STAGE_REBUILD = isTruthy(process.env.REPAIR_STAGE_REBUILD, true);
const STAGE_PAYMENT_PROOF = isTruthy(process.env.REPAIR_STAGE_PAYMENT_PROOF, true);
const STAGE_MAX_MOVES = Number.parseInt(process.env.REPAIR_STAGE_MAX_MOVES || '80', 10);

const YEARLY_HEADERS = [
  'Datum',
  'Lieferant',
  'Rechnungsnr',
  'Typ',
  'Betrag_Netto',
  'MwSt_Satz',
  'MwSt_Betrag',
  'Betrag_Brutto',
  'Kategorie',
  'Status',
  'Bemerkung',
  'Dateiname',
  'reason',
  'drive_file_id',
  'file_url',
  'beleg_id',
  'kunde',
  'leistungsdatum',
  'mwst_19_betrag',
  'mwst_7_betrag',
  'mwst_0_betrag',
  'geschaeftliche_mwst',
  'private_mwst',
  'geschaeftlicher_anteil_brutto',
  'privater_anteil_brutto',
  'sollkonto',
  'habenkonto',
  'iban',
  'bic',
  'bankleitzahl',
  'line_items_json',
  'source_folder_id',
  'target_folder_id',
  'analyzed_at',
  'dateiname_original',
  'dateiname_standardisiert',
  'extracted_text',
  'ocr_text',
  'metadata'
];

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

function isTruthy(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
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

function detectMwstSatz(row: DbRow): string {
  const vat19 = parseAmount(row.mwst_19_betrag || '');
  const vat7 = parseAmount(row.mwst_7_betrag || '');
  const vat0 = parseAmount(row.mwst_0_betrag || '');
  if (vat19 > 0 && vat7 > 0) return '19+7';
  if (vat19 > 0) return '19';
  if (vat7 > 0) return '7';
  if (vat0 > 0) return '0';
  return '';
}

function normalizeProbe(values: string[]): string {
  return values.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPrivateByKeywords(values: string[]): boolean {
  const probe = normalizeProbe(values);
  return PRIVATE_KEYWORDS.some((keyword) => probe.includes(keyword));
}

function isArchiveByKeywords(values: string[]): boolean {
  const probe = normalizeProbe(values);
  return ARCHIVE_KEYWORDS.some((keyword) => probe.includes(keyword));
}

function hasConfirmationMarker(values: string[]): boolean {
  const probe = normalizeProbe(values);
  return CONFIRMATION_KEYWORDS.some((keyword) => probe.includes(keyword));
}

function hasInvoiceMarker(values: string[]): boolean {
  const probe = normalizeProbe(values);
  return INVOICE_KEYWORDS.some((keyword) => probe.includes(keyword));
}

function inferSupplierFromName(name: string): string {
  const base = (name || '').replace(/\.[a-z0-9]{2,6}$/i, '');
  const normalized = base
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  if (/^\d{5,}$/.test(lower)) {
    return `Rechnung ${lower.slice(0, 12)}`;
  }
  const known: Array<{ match: string; supplier: string }> = [
    { match: 'amazon', supplier: 'Amazon' },
    { match: 'obi', supplier: 'OBI' },
    { match: 'shell', supplier: 'Shell' },
    { match: 'aral', supplier: 'Aral' },
    { match: 'total', supplier: 'TotalEnergies' },
    { match: 'jet', supplier: 'JET' },
    { match: 'vattenfall', supplier: 'Vattenfall' },
    { match: 'ionos', supplier: 'IONOS' },
    { match: '1&1', supplier: '1&1' },
    { match: 'lieferando', supplier: 'Lieferando' },
    { match: 'wolt', supplier: 'Wolt' },
    { match: 'lidl', supplier: 'Lidl' },
    { match: 'rewe', supplier: 'Rewe' },
    { match: 'edeka', supplier: 'Edeka' },
    { match: 'flink', supplier: 'Flink' },
    { match: 'hdi', supplier: 'HDI' },
    { match: 'woolworth', supplier: 'Woolworth' },
    { match: 'zoe', supplier: 'ZOE Solar' },
    { match: 'jeremy schulze', supplier: 'Jeremy Schulze' }
  ];
  for (const entry of known) {
    if (lower.includes(entry.match)) return entry.supplier;
  }

  const cleaned = normalized
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (lower.includes('beleg')) {
    const digits = normalized.match(/\d{3,}/)?.[0] || '';
    return digits ? `Dokument ${digits}` : 'Dokument';
  }
  if (!cleaned) return normalized.slice(0, 80);
  return cleaned
    .split(' ')
    .slice(0, 4)
    .join(' ')
    .slice(0, 80);
}

function inferSupplierFromText(text: string): string {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
    .slice(0, 40);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('rechnung') || lower.includes('invoice')) continue;
    if (/^\d+$/.test(lower)) continue;
    if (/(gmbh|ag|kg|ug|e\.k\.|ohg|ltd|limited|services)/i.test(line)) {
      return line.slice(0, 80);
    }
  }
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('rechnung') || lower.includes('invoice')) continue;
    if (/[a-zA-ZÄÖÜäöüß]{3,}/.test(line)) return line.slice(0, 80);
  }
  return '';
}

function sanitizeSupplier(raw: string, fallbackName: string, belegRow?: BelegeRow): string {
  const value = (raw || '').trim();
  const lowered = value.toLowerCase();
  const looksLikeFilenameNoise = lowered.includes('rechnung_') || lowered.includes('invoice_') || lowered.includes('.com_');
  const mostlyNumeric = /^\d{5,}$/.test(value);
  const hasLetters = /[a-zA-ZÄÖÜäöüß]{2,}/.test(value);
  if (value && hasLetters && !looksLikeFilenameNoise && !mostlyNumeric && !['unklar', 'unknown', 'n/a', 'null', 'beleg'].includes(lowered)) {
    return value;
  }
  const fromText = inferSupplierFromText(`${belegRow?.extracted_text || ''}\n${belegRow?.ocr_text || ''}`);
  if (fromText) return fromText;
  return inferSupplierFromName(fallbackName) || fallbackName || 'Beleg';
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

  const yearFromText = inferYearFromText([
    db?.dateiname_original || '',
    beleg?.original_name || '',
    (beleg?.extracted_text || '').slice(0, 5000),
    (beleg?.ocr_text || '').slice(0, 5000)
  ].join('\n'));
  return yearFromText;
}

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBusinessKey(dbRow: DbRow | undefined): string {
  if (!dbRow) return '';
  const supplier = (dbRow.lieferant || '').trim().toLowerCase();
  const invoiceNo = (dbRow.belegnr || '').trim().toLowerCase();
  const date = (dbRow.belegdatum || '').trim();
  const gross = parseAmount(dbRow.brutto_gesamt || '');
  if (!supplier || !date || gross <= 0) return '';
  if (invoiceNo) {
    return `${supplier}|${invoiceNo}|${date}|${gross.toFixed(2)}`;
  }
  return `${supplier}|${date}|${gross.toFixed(2)}`;
}

type ExpenseAction = 'keep' | 'private' | 'archive' | 'missing';

function classifyExpenseAction(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): { action: ExpenseAction; reason: string } {
  const signals = [
    file.name,
    db?.lieferant || '',
    db?.steuerkategorie || '',
    db?.hinweis || '',
    db?.belegart || '',
    beleg?.category || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ];
  const probe = normalizeProbe(signals);
  const vat7 = parseAmount(db?.mwst_7_betrag || '');
  const vat0 = parseAmount(db?.mwst_0_betrag || '');
  const hasFuel = FUEL_KEYWORDS.some((k) => probe.includes(k));
  const hasPrivateItem = PRIVATE_ITEM_KEYWORDS.some((k) => probe.includes(k));

  const isIonosOr11 = probe.includes('ionos') || probe.includes('1&1') || probe.includes('1und1');
  if (isIonosOr11 && !hasInvoiceMarker(signals)) {
    return { action: 'archive', reason: 'IONOS/1&1 ohne echte Rechnung' };
  }

  if (hasConfirmationMarker(signals) && !hasInvoiceMarker(signals)) {
    return { action: 'missing', reason: 'Nur Bestell/Liefer/Kaufbestaetigung' };
  }

  if (isArchiveByKeywords(signals)) {
    return { action: 'archive', reason: 'Nicht gewerblich / Archiv-Regel' };
  }

  // Mixed fuel receipts stay in expenses; private share is handled in accounting split fields.
  if (hasFuel) {
    return { action: 'keep', reason: 'Kraftstoffbeleg (Mischpositionen werden separat gesplittet)' };
  }

  if (vat7 > 0) {
    return { action: 'private', reason: 'Ausgabe mit 7% MwSt laut Vorgabe aus Ausgaben_2023 entfernen' };
  }

  if (vat0 > 0) {
    return { action: 'private', reason: 'Ausgabe mit 0% MwSt laut Vorgabe aus Ausgaben_2023 entfernen' };
  }

  if (isPrivateByKeywords(signals)) {
    return { action: 'private', reason: 'Privat-/Konsum-Regel' };
  }

  const hasFood = hasPrivateItem || ['lebensmittel', 'supermarkt', 'getraenke', 'getränke', 'tierfutter', 'drogerie'].some((k) => probe.includes(k));
  if (hasFood) {
    return { action: 'private', reason: 'Lebensmittel/Tierfutter/Drogerie' };
  }

  return { action: 'keep', reason: '' };
}

function normalizeInvoiceToken(value: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractAmountTokens(value: string): string[] {
  const out: string[] = [];
  const matches = value.match(/\d+[.,]\d{2}/g) || [];
  for (const m of matches) {
    const parsed = parseAmount(m);
    if (parsed > 0) out.push(parsed.toFixed(2));
  }
  return out;
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
    beleg?.original_name || '',
    beleg?.category || '',
    db?.belegnr || '',
    db?.hinweis || '',
    db?.steuerkategorie || '',
    db?.belegdatum || '',
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
  if (isPrivateByKeywords([probe])) expenseScore += 2;
  if (ARCHIVE_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (gross <= 0 && !strongIncomeEvidence) incomeScore -= 1;

  if (incomeScore >= expenseScore + 2 && strongIncomeEvidence) return 'Einnahmen';
  if (expenseScore >= incomeScore + 2) return 'Ausgaben';
  if (currentFlow === 'Einnahmen' && incomeScore >= expenseScore) return 'Einnahmen';
  if (currentFlow === 'Ausgaben' && expenseScore >= incomeScore) return 'Ausgaben';
  return currentFlow;
}

function shouldMoveIncomeToExpense(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): boolean {
  const probe = normalizeProbe([
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    db?.belegnr || '',
    db?.hinweis || '',
    db?.steuerkategorie || '',
    db?.belegart || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ]);
  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const hasCustomer = Boolean((db?.kunde || '').trim());
  const hasIncomeMarkers = /abschlagsrechnung|abschlagszahlung|schlussrechnung|teilrechnung|rechnungsplan|angebot|pv anlage|inbetriebnahme|zahlung nach vertragsabschluss|rechnung|invoice/.test(probe);
  const hasExpenseMarkers = /tankstelle|kraftstoff|diesel|benzin|kassenbon|quittung|obi|bauhaus|hornbach|hellweg|lieferando|wolt|rewe|edeka|lidl|flink|myplace|miete|versicherung|strom|vattenfall|drogerie|tierfutter|lebensmittel/.test(probe);
  if (ownBusiness || hasCustomer || hasIncomeMarkers) return false;
  return hasExpenseMarkers;
}

type IncomeAction = 'keep' | 'private' | 'archive' | 'missing';

function classifyIncomeAction(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): { action: IncomeAction; reason: string } {
  const signals = [
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    db?.steuerkategorie || '',
    db?.hinweis || '',
    db?.belegart || '',
    beleg?.category || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ];
  const probe = normalizeProbe(signals);
  const hasSalesPattern = /abschlagsrechnung|schlussrechnung|teilrechnung|rechnung/.test(probe);
  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const hasCustomer = Boolean((db?.kunde || '').trim());

  if (isArchiveByKeywords(signals)) {
    return { action: 'archive', reason: 'Nicht gewerblich / Archiv-Regel' };
  }
  if (isPrivateByKeywords(signals)) {
    return { action: 'private', reason: 'Privat-/Konsum-Regel' };
  }
  if (hasConfirmationMarker(signals) && !hasInvoiceMarker(signals)) {
    return { action: 'missing', reason: 'Nur Bestell/Liefer/Kaufbestaetigung' };
  }

  // In Einnahmen nur echte Ausgangsrechnungen behalten.
  if (!hasCustomer && !ownBusiness && !hasSalesPattern) {
    return { action: 'missing', reason: 'Keine belastbare Einnahme-Rechnungssignatur' };
  }
  return { action: 'keep', reason: '' };
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

async function moveFile(driveApi: drive_v3.Drive, fileId: string, targetFolderId: string): Promise<void> {
  const current = await runWithRateLimitRetry(
    () => driveApi.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true
    }),
    `moveFile.get.${fileId}`
  );
  const previousParents = (current.data.parents || []).join(',');
  await runWithRateLimitRetry(
    () => driveApi.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      supportsAllDrives: true,
      fields: 'id,parents'
    }),
    `moveFile.update.${fileId}`
  );
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

function chooseOriginal(files: DriveFile[]): DriveFile {
  return [...files].sort((a, b) => {
    const aTs = Date.parse(a.createdTime || a.modifiedTime || '');
    const bTs = Date.parse(b.createdTime || b.modifiedTime || '');
    const aVal = Number.isNaN(aTs) ? Number.MAX_SAFE_INTEGER : aTs;
    const bVal = Number.isNaN(bTs) ? Number.MAX_SAFE_INTEGER : bTs;
    if (aVal !== bVal) return aVal - bVal;
    return a.id.localeCompare(b.id);
  })[0];
}

function toTimestamp(file: DriveFile): number {
  const ts = Date.parse(file.createdTime || file.modifiedTime || '');
  if (Number.isNaN(ts)) return Number.MAX_SAFE_INTEGER;
  return ts;
}

function normalizeKeyValue(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(value: string): Set<string> {
  const stop = new Set([
    'der', 'die', 'das', 'und', 'oder', 'von', 'mit', 'auf', 'für', 'fuer', 'zum', 'zur', 'des', 'den',
    'dem', 'ein', 'eine', 'einer', 'eines', 'netto', 'brutto', 'mwst', 'ust', 'eur', 'euro', 'gesamt',
    'rechnung', 'beleg', 'invoice', 'quittung', 'zahlbetrag', 'summe', 'betrag'
  ]);
  const normalized = normalizeKeyValue(value);
  const tokens = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 400);
  return new Set(tokens);
}

function tokenOverlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) inter++;
  }
  return inter / Math.max(1, Math.min(a.size, b.size));
}

function buildContentDoc(file: DriveFile, db: DbRow | undefined, beleg: BelegeRow | undefined): ContentDoc {
  const supplier = normalizeKeyValue(db?.lieferant || beleg?.category || '');
  const invoiceNo = normalizeKeyValue(db?.belegnr || '');
  const date = normalizeDate(db?.belegdatum || '') || inferDateFromName(file.name);
  const gross = parseAmount(db?.brutto_gesamt || '');
  const contentProbe = [
    file.name,
    db?.lieferant || '',
    db?.belegnr || '',
    db?.belegdatum || '',
    db?.brutto_gesamt || '',
    db?.steuerkategorie || '',
    db?.kunde || '',
    db?.hinweis || '',
    (beleg?.extracted_text || '').slice(0, 6000),
    (beleg?.ocr_text || '').slice(0, 6000)
  ].join('\n');
  const tokens = tokenizeForSimilarity(contentProbe);
  return { file, supplier, invoiceNo, date, gross, tokens };
}

function isContentDuplicate(a: ContentDoc, b: ContentDoc): boolean {
  const sameInvoiceNo = a.invoiceNo && b.invoiceNo && a.invoiceNo === b.invoiceNo;
  const sameDate = a.date && b.date && a.date === b.date;
  const sameSupplier = a.supplier && b.supplier && (
    a.supplier === b.supplier ||
    a.supplier.includes(b.supplier) ||
    b.supplier.includes(a.supplier)
  );
  const sameAmount = a.gross > 0 && b.gross > 0 && Math.abs(a.gross - b.gross) <= 0.02;
  const score = tokenOverlapScore(a.tokens, b.tokens);

  if (sameInvoiceNo && sameAmount) return true;
  if (sameInvoiceNo && sameSupplier && (sameAmount || sameDate)) return true;
  if (sameAmount && sameDate && score >= 0.72) return true;
  if (sameAmount && score >= 0.84) return true;
  if (sameSupplier && sameAmount && score >= 0.68) return true;
  if (score >= 0.93 && (sameDate || sameAmount || sameSupplier)) return true;
  return false;
}

function dbRowToYearlyRow(
  dbRow: DbRow,
  belegRow: BelegeRow | undefined,
  file: DriveFile,
  fallbackName: string,
  flow: Flow
): string[] {
  const vatBusiness = parseAmount(dbRow.geschaeftliche_mwst || '');
  const vatFromRates = parseAmount(dbRow.mwst_19_betrag || '') + parseAmount(dbRow.mwst_7_betrag || '');
  const mwstBetrag = vatBusiness > 0 ? vatBusiness : vatFromRates;
  const dateiname = dbRow.dateiname_standardisiert || dbRow.dateiname_original || belegRow?.original_name || fallbackName;
  const type = dbRow.belegart || (flow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe');
  const supplier = sanitizeSupplier(dbRow.lieferant || '', dateiname, belegRow);
  const belegdatum = normalizeDate(dbRow.belegdatum || '')
    || inferDateFromName(dateiname)
    || inferDateFromName(file.name)
    || dateFromDriveTimestamp(file.modifiedTime || file.createdTime);

  return [
    belegdatum,
    supplier,
    dbRow.belegnr || '',
    type,
    dbRow.netto_gesamt || '',
    detectMwstSatz(dbRow),
    mwstBetrag ? mwstBetrag.toFixed(2) : '',
    dbRow.brutto_gesamt || '',
    dbRow.steuerkategorie || belegRow?.category || '',
    dbRow.status || '',
    dbRow.hinweis || '',
    dateiname,
    dbRow.duplikat_gruppe || '',
    dbRow.drive_file_id || belegRow?.drive_file_id || '',
    dbRow.file_url || belegRow?.file_url || '',
    dbRow.beleg_id || '',
    dbRow.kunde || '',
    dbRow.leistungsdatum || '',
    dbRow.mwst_19_betrag || '',
    dbRow.mwst_7_betrag || '',
    dbRow.mwst_0_betrag || '',
    dbRow.geschaeftliche_mwst || '',
    dbRow.private_mwst || '',
    dbRow.geschaeftlicher_anteil_brutto || '',
    dbRow.privater_anteil_brutto || '',
    dbRow.sollkonto || '',
    dbRow.habenkonto || '',
    dbRow.iban || '',
    dbRow.bic || '',
    dbRow.bankleitzahl || '',
    dbRow.line_items_json || '',
    dbRow.source_folder_id || belegRow?.source_folder_id || '',
    dbRow.target_folder_id || belegRow?.target_folder_id || '',
    dbRow.analyzed_at || belegRow?.analyzed_at || '',
    dbRow.dateiname_original || belegRow?.original_name || fallbackName,
    dbRow.dateiname_standardisiert || '',
    belegRow?.extracted_text || '',
    belegRow?.ocr_text || '',
    belegRow?.metadata || ''
  ];
}

function fallbackYearlyRow(file: DriveFile, belegRow: BelegeRow | undefined, flow: Flow): string[] {
  const type = flow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe';
  const supplier = inferSupplierFromName(file.name) || 'Beleg';
  const belegdatum = inferDateFromName(file.name) || dateFromDriveTimestamp(file.modifiedTime || file.createdTime);
  return [
    belegdatum,
    supplier,
    '',
    type,
    '',
    '',
    '',
    '',
    belegRow?.category || '',
    'pending',
    'Auto-fallback: kein Buchhaltung_DB-Eintrag',
    file.name,
    '',
    file.id,
    file.webViewLink,
    file.id,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '[]',
    belegRow?.source_folder_id || '',
    belegRow?.target_folder_id || file.parentId,
    belegRow?.analyzed_at || '',
    belegRow?.original_name || file.name,
    '',
    belegRow?.extracted_text || '',
    belegRow?.ocr_text || '',
    belegRow?.metadata || ''
  ];
}

async function ensureSheet(sheetsApi: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<number> {
  const ss = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }),
    `ensureSheet.get.${title}`
  );
  const existing = (ss.data.sheets || []).find((s) => s.properties?.title === title);
  if (typeof existing?.properties?.sheetId === 'number') return existing.properties.sheetId;

  const create = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    }),
    `ensureSheet.create.${title}`
  );
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Failed to create sheet ${title}`);
  return id;
}

async function writeYearSheet(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: string[][]
): Promise<void> {
  const sheetId = await ensureSheet(sheetsApi, spreadsheetId, title);
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: `${title}!A:ZZ` }),
    `writeYearSheet.clear.${title}`
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [YEARLY_HEADERS, ...rows] }
    }),
    `writeYearSheet.update.${title}`
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
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
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: YEARLY_HEADERS.length
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat.textFormat.bold'
            }
          },
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: Math.max(1, rows.length + 1),
                  startColumnIndex: 0,
                  endColumnIndex: YEARLY_HEADERS.length
                }
              }
            }
          }
        ]
      }
    }),
    `writeYearSheet.format.${title}`
  );
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

  const yearFolder = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, TARGET_YEAR);
  if (!yearFolder) throw new Error(`${TARGET_YEAR} folder not found`);
  const incomeFolderName = `Einnahmen_${TARGET_YEAR}`;
  const expenseFolderName = `Ausgaben_${TARGET_YEAR}`;
  const incomeFolder = await findFolderByName(driveApi, yearFolder.id, incomeFolderName);
  const expenseFolder = await findFolderByName(driveApi, yearFolder.id, expenseFolderName);
  if (!incomeFolder || !expenseFolder) throw new Error(`${incomeFolderName} or ${expenseFolderName} folder not found`);
  const flowFolderCache = new Map<string, FolderNode | null>();

  const getFlowFolderForYear = async (year: string, flow: Flow): Promise<FolderNode | null> => {
    const key = `${year}:${flow}`;
    if (flowFolderCache.has(key)) return flowFolderCache.get(key) || null;
    const yearNode = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, year);
    if (!yearNode) {
      flowFolderCache.set(key, null);
      return null;
    }
    const flowName = `${flow}_${year}`;
    const flowFolder = await findFolderByName(driveApi, yearNode.id, flowName);
    flowFolderCache.set(key, flowFolder);
    return flowFolder;
  };

  const dbRows = await readTableRows(sheetsApi, spreadsheetId, 'Buchhaltung_DB');
  const dbByDriveId = new Map<string, DbRow>();
  for (const row of dbRows) {
    const id = row.drive_file_id || '';
    if (id && !dbByDriveId.has(id)) dbByDriveId.set(id, row);
  }
  const belegRows = await readTableRows(sheetsApi, spreadsheetId, 'belege');
  const belegeByDriveId = new Map<string, BelegeRow>();
  for (const row of belegRows) {
    const id = row.drive_file_id || '';
    if (id && !belegeByDriveId.has(id)) belegeByDriveId.set(id, row);
  }

  let movedPrivate = 0;
  let movedArchive = 0;
  let movedMissing = 0;
  let movedDuplicate = 0;
  let movedFlow = 0;
  let movedYear = 0;
  let movedPaymentProofMissing = 0;
  let stageMoveCounter = 0;
  let restoredIncomeFromArchive = 0;
  const rebuildStats: Array<{ tab: string; rowCount: number }> = [];
  let incomeInvoiceCount = 0;
  const incomeInvoiceNos = new Set<string>();
  const incomeAmounts = new Set<string>();
  let stageCapReached = false;

  const canMoveMore = (): boolean => {
    if (!Number.isFinite(STAGE_MAX_MOVES) || STAGE_MAX_MOVES <= 0) return true;
    return stageMoveCounter < STAGE_MAX_MOVES;
  };
  const registerMove = (): void => {
    stageMoveCounter++;
    if (!canMoveMore()) {
      stageCapReached = true;
    }
  };

  // Recover likely 2023 income invoices that may have been archived in previous corrective runs.
  if (STAGE_RESTORE_ARCHIVE) {
    const archiveFiles = await listFilesRecursive(driveApi, ARCHIVE_FOLDER_ID, 'Archiviert');
    for (const file of archiveFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const dateProbe = `${db?.belegdatum || ''} ${file.name}`;
      const is2023 = dateProbe.includes(TARGET_YEAR);
      if (!is2023) continue;
      const desired = desiredFlowFromSignals(file, db, beleg, 'Ausgaben');
      if (desired !== 'Einnahmen') continue;
      await moveFile(driveApi, file.id, incomeFolder.id);
      restoredIncomeFromArchive++;
      registerMove();
    }
  }

  const folderSpecs: Array<{ flow: Flow; folder: FolderNode; tab: string }> = [
    { flow: 'Ausgaben', folder: expenseFolder, tab: expenseFolderName },
    { flow: 'Einnahmen', folder: incomeFolder, tab: incomeFolderName }
  ];

  for (const spec of folderSpecs) {
    if (!canMoveMore()) break;
    const initialFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);

    if (STAGE_DEDUPE) {
      const byMd5 = new Map<string, DriveFile[]>();
      const byNameSize = new Map<string, DriveFile[]>();
      for (const file of initialFiles) {
        if (file.md5Checksum) {
          const key = `md5:${file.md5Checksum}`;
          const group = byMd5.get(key) || [];
          group.push(file);
          byMd5.set(key, group);
        } else if (file.size > 0) {
          const key = `name_size:${normalizeName(file.name)}|${file.size}`;
          const group = byNameSize.get(key) || [];
          group.push(file);
          byNameSize.set(key, group);
        }
      }

      const duplicatesToMove = new Set<string>();
      for (const group of byMd5.values()) {
        if (group.length < 2) continue;
        const original = chooseOriginal(group);
        for (const file of group) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }
      for (const group of byNameSize.values()) {
        if (group.length < 2) continue;
        const unresolved = group.filter((f) => !duplicatesToMove.has(f.id));
        if (unresolved.length < 2) continue;
        const original = chooseOriginal(unresolved);
        for (const file of unresolved) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }

      const byBusinessKey = new Map<string, DriveFile[]>();
      for (const file of initialFiles) {
        const key = toBusinessKey(dbByDriveId.get(file.id));
        if (!key) continue;
        const group = byBusinessKey.get(key) || [];
        group.push(file);
        byBusinessKey.set(key, group);
      }
      for (const group of byBusinessKey.values()) {
        const unresolved = group.filter((f) => !duplicatesToMove.has(f.id));
        if (unresolved.length < 2) continue;
        const original = chooseOriginal(unresolved);
        for (const file of unresolved) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }

      // Content-based duplicate detection (OCR/Text + business facts), not name-only.
      const unresolvedDocs = initialFiles
        .filter((f) => !duplicatesToMove.has(f.id))
        .map((f) => buildContentDoc(f, dbByDriveId.get(f.id), belegeByDriveId.get(f.id)));
      const blocks = new Map<string, ContentDoc[]>();
      for (const doc of unresolvedDocs) {
        if (doc.gross > 0 && doc.date) {
          const k = `amount_date:${doc.gross.toFixed(2)}|${doc.date}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
        if (doc.invoiceNo && doc.gross > 0) {
          const k = `invoice_amount:${doc.invoiceNo}|${doc.gross.toFixed(2)}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
        if (doc.supplier && doc.gross > 0 && doc.date) {
          const k = `supplier_amount_date:${doc.supplier}|${doc.gross.toFixed(2)}|${doc.date}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
      }

      for (const group of blocks.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort((a, b) => toTimestamp(a.file) - toTimestamp(b.file));
        const originals: ContentDoc[] = [];
        for (const candidate of sorted) {
          if (duplicatesToMove.has(candidate.file.id)) continue;
          let isDup = false;
          for (const original of originals) {
            if (isContentDuplicate(original, candidate)) {
              isDup = true;
              break;
            }
          }
          if (isDup) {
            duplicatesToMove.add(candidate.file.id);
          } else {
            originals.push(candidate);
          }
        }
      }

      for (const fileId of duplicatesToMove) {
        if (!canMoveMore()) break;
        await moveFile(driveApi, fileId, DUPLICATE_FOLDER_ID);
        movedDuplicate++;
        registerMove();
      }
    }

    const afterDuplicateFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);
    if (STAGE_MOVE_POLICY || STAGE_MOVE_FLOW || STAGE_MOVE_YEAR) {
      for (const file of afterDuplicateFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const desiredFlow = desiredFlowFromSignals(file, db, beleg, spec.flow);
      const docYear = inferDocumentYear(file, db, beleg);

      if (STAGE_MOVE_YEAR && docYear && docYear !== TARGET_YEAR) {
        const destinationFlow = desiredFlow;
        const targetFolder = await getFlowFolderForYear(docYear, destinationFlow);
        if (targetFolder) {
          await moveFile(driveApi, file.id, targetFolder.id);
          movedYear++;
          registerMove();
          continue;
        }
      }

      if (spec.flow === 'Ausgaben') {
        if (STAGE_MOVE_FLOW && desiredFlow === 'Einnahmen') {
          await moveFile(driveApi, file.id, incomeFolder.id);
          movedFlow++;
          registerMove();
          continue;
        }

        if (STAGE_MOVE_POLICY) {
          const decision = classifyExpenseAction(file, db, beleg);
          if (decision.action === 'keep') {
            continue;
          }

          const destination = decision.action === 'private'
            ? PRIVATE_FOLDER_ID
            : decision.action === 'archive'
              ? ARCHIVE_FOLDER_ID
              : MISSING_FOLDER_ID;
          await moveFile(driveApi, file.id, destination);
          if (decision.action === 'private') movedPrivate++;
          if (decision.action === 'archive') movedArchive++;
          if (decision.action === 'missing') movedMissing++;
          registerMove();
        }
        continue;
      }
      if (STAGE_MOVE_FLOW && desiredFlow === 'Ausgaben') {
        if (shouldMoveIncomeToExpense(file, db, beleg)) {
          await moveFile(driveApi, file.id, expenseFolder.id);
          movedFlow++;
          registerMove();
          continue;
        }
      }

      if (STAGE_MOVE_POLICY) {
        const decision = classifyIncomeAction(file, db, beleg);
        if (decision.action === 'keep') {
          continue;
        }
        const destination = decision.action === 'private'
          ? PRIVATE_FOLDER_ID
          : decision.action === 'archive'
            ? ARCHIVE_FOLDER_ID
            : MISSING_FOLDER_ID;
        await moveFile(driveApi, file.id, destination);
        if (decision.action === 'private') movedPrivate++;
        if (decision.action === 'archive') movedArchive++;
        if (decision.action === 'missing') movedMissing++;
        registerMove();
        continue;
      }
    }
    }

    if (!STAGE_REBUILD) continue;

    const finalFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);
    finalFiles.sort((a, b) => a.name.localeCompare(b.name));

    const rows: string[][] = [];
    for (const file of finalFiles) {
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      if (db) {
        rows.push(dbRowToYearlyRow(db, beleg, file, file.name, spec.flow));
      } else {
        rows.push(fallbackYearlyRow(file, beleg, spec.flow));
      }

      if (spec.flow === 'Einnahmen') {
        const d = dbByDriveId.get(file.id);
        const no = (d?.belegnr || '').trim().toLowerCase();
        const gross = parseAmount(d?.brutto_gesamt || '');
        if (no) incomeInvoiceNos.add(no);
        if (gross > 0) incomeAmounts.add(gross.toFixed(2));
        if (d?.belegart?.toLowerCase().includes('einnahme')) {
          incomeInvoiceCount++;
        }
      }
    }

    await writeYearSheet(sheetsApi, spreadsheetId, spec.tab, rows);
    rebuildStats.push({ tab: spec.tab, rowCount: rows.length });
  }

  if (STAGE_PAYMENT_PROOF) try {
    const paymentProofFiles = await listFilesRecursive(driveApi, PAYMENT_PROOF_FOLDER_ID, `payment_proofs_${TARGET_YEAR}`);
    for (const file of paymentProofFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const signals = [
        file.name,
        db?.belegnr || '',
        db?.brutto_gesamt || '',
        db?.lieferant || '',
        beleg?.original_name || '',
        beleg?.ocr_text || '',
        beleg?.extracted_text || ''
      ];
      const probe = normalizeProbe(signals);
      const normalizedProbe = normalizeInvoiceToken(probe);

      let matched = false;
      for (const invoiceNo of incomeInvoiceNos) {
        if (!invoiceNo) continue;
        const token = normalizeInvoiceToken(invoiceNo);
        if (token.length >= 4 && normalizedProbe.includes(token)) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        const amountTokens = extractAmountTokens(probe);
        matched = amountTokens.some((amount) => incomeAmounts.has(amount));
      }

      if (!matched) {
        await moveFile(driveApi, file.id, MISSING_FOLDER_ID);
        movedPaymentProofMissing++;
        registerMove();
      }
    }
  } catch (error: any) {
    const status = error?.response?.status || error?.code;
    if (status !== 404) throw error;
  }

  console.log(JSON.stringify({
    status: 'ok',
    year: TARGET_YEAR,
    movedPrivate,
    movedArchive,
    movedMissing,
    movedDuplicate,
    movedFlow,
    movedYear,
    movedPaymentProofMissing,
    stageMoveCounter,
    stageMoveCap: Number.isFinite(STAGE_MAX_MOVES) ? STAGE_MAX_MOVES : 0,
    stageCapReached,
    restoredIncomeFromArchive,
    stages: {
      restoreArchive: STAGE_RESTORE_ARCHIVE,
      dedupe: STAGE_DEDUPE,
      movePolicy: STAGE_MOVE_POLICY,
      moveFlow: STAGE_MOVE_FLOW,
      moveYear: STAGE_MOVE_YEAR,
      rebuild: STAGE_REBUILD,
      paymentProof: STAGE_PAYMENT_PROOF
    },
    incomeInvoiceCount,
    rebuildStats
  }, null, 2));
}

withPipelineLock('repair_2023', main).catch((error) => {
  console.error('repair_2023 failed:', error);
  process.exit(1);
});
