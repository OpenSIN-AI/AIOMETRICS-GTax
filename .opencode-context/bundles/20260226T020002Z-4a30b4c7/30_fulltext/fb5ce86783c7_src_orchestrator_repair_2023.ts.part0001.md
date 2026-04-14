# Context Fulltext

- source_path: src/orchestrator/repair_2023.ts
- source_sha256: 0f706c6982ec4756cf54653e720a13104fae58266c0636c9ab698f61fe4114e9
- chunk: 1/5

```text
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
  tokens: [REDACTED]
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
    .replace(/[_\-]+/g,
```
