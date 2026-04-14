import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.MICRO_UNCLEAR_BATCH || '500', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.MICRO_UNCLEAR_RUN_BUDGET_MS || '170000', 10);
const MIN_CONFIDENCE = Number.parseFloat(process.env.MICRO_UNCLEAR_MIN_CONFIDENCE || '0.56');
const APPLY_UPDATES = !['0', 'false', 'no', 'off'].includes(String(process.env.MICRO_UNCLEAR_APPLY || '1').toLowerCase());
const ZERO_NON_TRANSACTION = !['0', 'false', 'no', 'off'].includes(String(process.env.MICRO_UNCLEAR_ZERO_NON_TRANSACTION || '1').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_RESOLVE_UNCLEAR.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_UNCLEAR_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_UNCLEAR_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_UNCLEAR_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_UNCLEAR_API_RETRY_MAX_MS, 15000);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ]
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

type RawCell = string | number | undefined;
type RawRow = RawCell[];
type RowObj = Record<string, string>;
type Belegart = 'Einnahme' | 'Ausgabe' | 'Unklar';

interface Classification {
  belegart: Belegart;
  steuerkategorie: string;
  confidence: number;
  nonTransaction: boolean;
  incomeScore: number;
  expenseScore: number;
  reasons: string[];
}

type FlowHint = '' | 'Einnahmen' | 'Ausgaben';

interface AmountResolution {
  gross: number;
  net: number;
  vat19: number;
  vat7: number;
  vat0: number;
  source: string;
  scaleCorrected: boolean;
}

interface ProcessedRow {
  rowNumber: number;
  driveId: string;
  beforeType: string;
  afterType: string;
  beforeTax: string;
  afterTax: string;
  confidence: number;
  nonTransaction: boolean;
  grossBefore: number;
  grossAfter: number;
  scaleCorrected: boolean;
  reasons: string;
}

function normalize(input: string): string {
  return String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toBoolText(value: boolean): string {
  return value ? 'true' : 'false';
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function parseAmount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return round2(raw);
  const text = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (!text) return 0;

  const sign = text.startsWith('-') ? -1 : 1;
  const unsigned = text.replace(/-/g, '');
  if (!unsigned) return 0;

  const hasComma = unsigned.includes(',');
  const hasDot = unsigned.includes('.');
  let normalized = unsigned;

  if (hasComma && hasDot) {
    normalized = unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.')
      ? unsigned.replace(/\./g, '').replace(/,/g, '.')
      : unsigned.replace(/,/g, '');
  } else if (hasComma) {
    const pos = unsigned.lastIndexOf(',');
    const frac = unsigned.slice(pos + 1);
    if (frac.length === 2) {
      normalized = `${unsigned.slice(0, pos).replace(/[.,]/g, '')}.${frac}`;
    } else if (unsigned.split(',').length === 2 && frac.length === 3) {
      normalized = unsigned.replace(/,/g, '');
    } else {
      normalized = unsigned.replace(/,/g, '.');
    }
  } else if (hasDot) {
    const pos = unsigned.lastIndexOf('.');
    const frac = unsigned.slice(pos + 1);
    if (frac.length === 2) {
      normalized = `${unsigned.slice(0, pos).replace(/\./g, '')}.${frac}`;
    } else if (unsigned.split('.').length === 2 && frac.length === 3) {
      normalized = unsigned.replace(/\./g, '');
    }
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? round2(sign * parsed) : 0;
}

function parseDateIso(text: string): string {
  const dmy = text.match(/\b([0-3]?\d)[.\-/]([01]?\d)[.\-/]((?:19|20)\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = text.match(/\b((?:19|20)\d{2})[.\-/]([01]?\d)[.\-/]([0-3]?\d)\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return '';
}

function parseInvoiceNo(text: string): string {
  const match = text.match(/(?:rechnungs?nr\.?|rechnung\s*nr\.?|invoice\s*no\.?|belegnr\.?)\s*[:#]?\s*([A-Za-z0-9._\-/]{4,})/i);
  if (match?.[1]) return match[1];
  const fallback = text.match(/\b\d{4}\.\d+\.\d+\b/);
  return fallback?.[0] || '';
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseAmounts(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/g)) {
    const amount = parseAmount(match[0]);
    if (Number.isFinite(amount) && amount > 0) values.push(amount);
  }
  return values;
}

function detectPrimaryGross(text: string): number {
  const patterns = [
    /(?:gesamt(?:betrag)?|summe|zahlbetrag|brutto|zu\s+zahlen|total)\D{0,24}([-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /(?:betrag\s*eur|eur\s*gesamt)\D{0,24}([-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = parseAmount(match[1]);
    if (parsed > 0 && parsed <= 300000) return round2(parsed);
  }
  const amounts = parseAmounts(text).filter((value) => value > 0 && value <= 300000);
  if (amounts.length === 0) return 0;
  return round2(Math.max(...amounts));
}

function inferSupplier(text: string, fallbackName: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 3);
  const blocked = ['rechnung', 'invoice', 'beleg', 'quittung', 'mwst', 'ust-id', 'summe', 'gesamt', 'zahlbetrag'];
  for (const line of lines.slice(0, 24)) {
    const lowered = line.toLowerCase();
    if (blocked.some((part) => lowered.includes(part))) continue;
    if (/^\d+$/.test(lowered)) continue;
    if (line.length > 2 && line.length <= 90) return line;
  }
  return fallbackName.replace(/\.[A-Za-z0-9]{2,6}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 90);
}

function colLetter(colIndex0: number): string {
  let n = colIndex0 + 1;
  let out = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_resolve_unclear'
  });
}

async function readSheet(tab: string): Promise<{ headers: string[]; rows: RawRow[] }> {
  const response = await withApiRetry(
    `sheets.values.get.${tab}`,
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A1:AZ`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const values = (response.data.values || []) as RawRow[];
  const headers = (values[0] || []).map((value) => String(value || '').trim());
  return { headers, rows: values.slice(1) };
}

function rowToObject(headers: string[], row: RawRow): RowObj {
  const obj: RowObj = {};
  headers.forEach((header, index) => {
    obj[header] = String(row[index] ?? '');
  });
  return obj;
}

function findHeader(headers: string[], name: string): number {
  return headers.indexOf(name);
}

function normalizeTaxFromMeta(rawTax: string): string {
  const tax = normalize(rawTax);
  if (!tax) return '';
  if (/nicht.*abzugsf|privat/.test(tax)) return 'Privat/Nicht abzugsfaehig';
  if (/kraftstoff|benzin|diesel|tank/.test(tax)) return 'Kraftstoff/Benzin';
  if (/material|waren|photovoltaik|\bpv\b/.test(tax)) return 'Material/PV';
  if (/telekommunikation|hosting|domain|software|it|cloud/.test(tax)) return 'Telekommunikation/IT';
  if (/versicherung/.test(tax)) return 'Versicherung';
  if (/miete|pacht/.test(tax)) return 'Miete';
  if (/strom|energie/.test(tax)) return 'Strom/Energie';
  if (/bewirt|restaurant|cafe|imbiss|wolt|lieferando/.test(tax)) return 'Bewirtung';
  if (/einnahmen.*0|0\s?%/.test(tax)) return 'Einnahmen 0% PV';
  if (/einnahmen.*7|7\s?%/.test(tax)) return 'Einnahmen 7%';
  if (/einnahmen|umsatz|erlos/.test(tax)) return 'Einnahmen 19%';
  if (/sonstig/.test(tax)) return 'Sonstige Ausgaben';
  return '';
}

function classify(context: {
  existingType: string;
  existingTax: string;
  allText: string;
  nameText: string;
  metadata: Record<string, unknown>;
  folderFlowHint: FlowHint;
}): Classification {
  const normText = normalize(context.allText);
  const normName = normalize(context.nameText);
  const normExistingTax = normalize(context.existingTax);
  const metaTaxRaw = String(context.metadata.tax_category || '');
  const metaTax = normalize(metaTaxRaw);
  const reasons: string[] = [];

  let incomeScore = 0;
  let expenseScore = 0;

  const addIncome = (score: number, reason: string): void => {
    incomeScore += score;
    reasons.push(`I+${score}:${reason}`);
  };
  const addExpense = (score: number, reason: string): void => {
    expenseScore += score;
    reasons.push(`E+${score}:${reason}`);
  };

  const nonTransaction = /einnahmen.{0,12}berschussrechnung|umsatzsteuer.{0,18}voranmeldung|steuerbescheid|jahresabschluss|gewinn.{0,8}verlust|kontenblatt|\bbwa\b|\belster\b/.test(normText);
  if (nonTransaction) {
    reasons.push('N:non_transaction_doc');
  }

  if (/^einnahme$/i.test(context.existingType)) addIncome(10, 'existing_type_income');
  if (/^ausgabe$/i.test(context.existingType)) addExpense(10, 'existing_type_expense');

  if (/einnahmen|umsatz|photovoltaik|\bpv\b/.test(normExistingTax)) addIncome(4, 'existing_tax_income_hint');
  if (/ausgaben|material|waren|kraftstoff|benzin|bewirt|telekommunikation|it|hosting|strom|energie|miete|versicherung|privat|sonstige/.test(normExistingTax)) {
    addExpense(4, 'existing_tax_expense_hint');
  }

  if (/einnahmen|umsatz|photovoltaik|\bpv\b/.test(metaTax)) addIncome(7, 'meta_tax_income');
  if (/ausgaben|material|waren|kraftstoff|benzin|bewirt|telekommunikation|it|hosting|strom|energie|miete|versicherung|privat|sonstige/.test(metaTax)) {
    addExpense(7, 'meta_tax_expense');
  }
  if (context.folderFlowHint === 'Einnahmen') addIncome(7, 'folder_flow_income');
  if (context.folderFlowHint === 'Ausgaben') addExpense(7, 'folder_flow_expense');

  const metaHaben = String(context.metadata.habenkonto || '').trim();
  const metaSoll = String(context.metadata.sollkonto || '').trim();
  if (['8400', '8300', '8336', '8338', '8125'].includes(metaHaben)) addIncome(8, 'meta_habenkonto_revenue');
  if (metaHaben === '1200' && !!metaSoll && metaSoll !== '1200') addExpense(8, 'meta_bank_against_expense');

  if (/(abschlagsrechnung|teilrechnung|schlussrechnung).{0,80}angebot\s*[:#]/.test(normText)) addIncome(8, 'project_invoice_offer_chain');
  if (/zukunfts\s*-?\s*orientierte\s*energie/.test(normText)) addIncome(6, 'zoe_branding_template');
  if (/kundenservice\s*:\s*\d/.test(normText) && /rechnung\s*nr/.test(normText)) addIncome(4, 'customer_service_invoice_template');

  if (/rechnung\s*an\s*:\s*(zoe|jeremy|zukunfts)/.test(normText)) addExpense(10, 'invoice_to_own_company');
  if (/sehr\s+geehrter\s+herr\s+schulze/.test(normText)) addExpense(5, 'addressed_to_owner');
  if (/receipt|bon-id|kassenbon|quittung/.test(normText)) addExpense(7, 'receipt_pattern');
  if (/kraftstoff|benzin|diesel|tankstelle|esso|totalenergies/.test(normText)) addExpense(7, 'fuel_pattern');
  if (/obi|bauhaus|lidl|rewe|edeka|flink|wolt|lieferando|ionos|telekom|vodafone|openai|adobe|apple|amazon/.test(normText)) {
    addExpense(6, 'merchant_expense_pattern');
  }

  if (/(^|\W)ausgabe(\W|$)|beleg\s*ausgabe/.test(normName)) addExpense(5, 'filename_expense_hint');
  if (/(^|\W)einnahme(\W|$)|beleg\s*einnahme/.test(normName)) addIncome(4, 'filename_income_hint');
  if (/(abschlagsrechnung|teilrechnung|schlussrechnung).{0,40}angebot/.test(normName)) addIncome(7, 'filename_project_income_chain');
  if (/invoice/.test(normName) && !/angebot/.test(normName)) addExpense(2, 'filename_invoice_default_expense');

  let belegart: Belegart = 'Unklar';
  if (!nonTransaction) {
    const diff = incomeScore - expenseScore;
    if (diff >= 2) {
      belegart = 'Einnahme';
    } else if (diff <= -2) {
      belegart = 'Ausgabe';
    } else if (incomeScore > 0 && expenseScore === 0) {
      belegart = 'Einnahme';
    } else if (expenseScore > 0 && incomeScore === 0) {
      belegart = 'Ausgabe';
    }
  }

  const normalizedMetaTax = normalizeTaxFromMeta(metaTaxRaw);
  let steuerkategorie = '';
  if (nonTransaction) {
    steuerkategorie = 'Nicht EUR-relevant (Archiv)';
  } else if (belegart === 'Einnahme') {
    if (normalizedMetaTax.startsWith('Einnahmen')) {
      steuerkategorie = normalizedMetaTax;
    } else if (/0\s?%|umsatzsteuerfrei|steuerfrei/.test(normText)) {
      steuerkategorie = 'Einnahmen 0% PV';
    } else if (/7\s?%/.test(normText)) {
      steuerkategorie = 'Einnahmen 7%';
    } else {
      steuerkategorie = 'Einnahmen 19%';
    }
  } else if (belegart === 'Ausgabe') {
    steuerkategorie = normalizedMetaTax;
    if (!steuerkategorie || steuerkategorie.startsWith('Einnahmen')) {
      if (/nicht.*abzugsf|privat|lidl|rewe|edeka|wolt|lieferando|netflix|drogerie|lebensmittel/.test(normText)) steuerkategorie = 'Privat/Nicht abzugsfaehig';
      else if (/kraftstoff|benzin|diesel|tankstelle|esso|totalenergies/.test(normText)) steuerkategorie = 'Kraftstoff/Benzin';
      else if (/material|waren|modul|wechselrichter|solarmodul|kabel|baustoff|baumarkt|\bpv\b|photovoltaik/.test(normText)) steuerkategorie = 'Material/PV';
      else if (/telekommunikation|hosting|domain|software|it|cloud|openai|adobe|apple|ionos|telekom|vodafone/.test(normText)) steuerkategorie = 'Telekommunikation/IT';
      else if (/versicherung|arag|hdi/.test(normText)) steuerkategorie = 'Versicherung';
      else if (/miete|pacht|hausverwaltung/.test(normText)) steuerkategorie = 'Miete';
      else if (/strom|energie|vattenfall/.test(normText)) steuerkategorie = 'Strom/Energie';
      else if (/bewirt|restaurant|cafe|imbiss/.test(normText)) steuerkategorie = 'Bewirtung';
      else steuerkategorie = 'Sonstige Ausgaben';
    }
  }

  const best = Math.max(incomeScore, expenseScore);
  const diffAbs = Math.abs(incomeScore - expenseScore);
  let confidence = Math.min(0.99, 0.32 + best * 0.045 + diffAbs * 0.04);
  if (nonTransaction) confidence = 0.99;
  if (belegart === 'Unklar' && !nonTransaction) confidence = Math.min(confidence, 0.49);

  return {
    belegart,
    steuerkategorie,
    confidence: round2(confidence),
    nonTransaction,
    incomeScore,
    expenseScore,
    reasons
  };
}

function resolveAmounts(context: {
  classification: Classification;
  existingGross: number;
  existingVat19: number;
  existingVat7: number;
  existingVat0: number;
  existingNet: number;
  text: string;
  metadata: Record<string, unknown>;
}): AmountResolution {
  const metaGross = parseAmount(context.metadata.gross_total);
  const metaVat19 = parseAmount(context.metadata.vat_19);
  const metaVat7 = parseAmount(context.metadata.vat_7);
  const metaVat0 = parseAmount(context.metadata.vat_0);
  const metaNet = parseAmount(context.metadata.net_total);
  const textGross = detectPrimaryGross(context.text);

  let gross = context.existingGross;
  let source = 'existing';
  let scaleCorrected = false;

  if (context.classification.nonTransaction && ZERO_NON_TRANSACTION) {
    return {
      gross: 0,
      net: 0,
      vat19: 0,
      vat7: 0,
      vat0: 0,
      source: 'non_transaction_zeroed',
      scaleCorrected: false
    };
  }

  if (metaGross > 0) {
    if (gross <= 0) {
      gross = metaGross;
      source = 'meta_gross';
    } else {
      const ratio = gross / metaGross;
      if (ratio > 95 && ratio < 105) {
        gross = metaGross;
        source = 'meta_gross_scale_fix';
        scaleCorrected = true;
      }
    }
  }

  if (gross <= 0 && textGross > 0) {
    gross = textGross;
    source = 'text_gross';
  } else if (gross > 0 && textGross > 0) {
    const ratio = gross / textGross;
    if (ratio > 95 && ratio < 105) {
      gross = textGross;
      source = 'text_gross_scale_fix';
      scaleCorrected = true;
    }
  }

  gross = round2(Math.max(0, gross));

  let vat19 = context.existingVat19;
  let vat7 = context.existingVat7;
  let vat0 = context.existingVat0;
  let net = context.existingNet;

  if (metaVat19 > 0 || metaVat7 > 0 || metaVat0 > 0 || metaNet > 0) {
    vat19 = metaVat19;
    vat7 = metaVat7;
    vat0 = metaVat0;
    if (metaNet > 0) net = metaNet;
    else net = round2(Math.max(0, gross - vat19 - vat7));
    return { gross, net, vat19, vat7, vat0, source, scaleCorrected };
  }

  const normText = normalize(context.text);
  const category = normalize(context.classification.steuerkategorie);
  if (context.classification.belegart === 'Einnahme') {
    if (/0\s?%|steuerfrei|umsatzsteuerfrei/.test(normText) || /0%/.test(category)) {
      vat19 = 0;
      vat7 = 0;
      vat0 = gross;
      net = gross;
    } else if (/7\s?%/.test(normText) || /7%/.test(category)) {
      vat7 = round2(gross * 7 / 107);
      vat19 = 0;
      vat0 = 0;
      net = round2(Math.max(0, gross - vat7));
    } else {
      vat19 = round2(gross * 19 / 119);
      vat7 = 0;
      vat0 = 0;
      net = round2(Math.max(0, gross - vat19));
    }
  } else if (context.classification.belegart === 'Ausgabe') {
    if (/privat/.test(category)) {
      vat19 = 0;
      vat7 = 0;
      vat0 = 0;
      net = gross;
    } else if (/7\s?%/.test(normText) || /7%/.test(category)) {
      vat7 = round2(gross * 7 / 107);
      vat19 = 0;
      vat0 = 0;
      net = round2(Math.max(0, gross - vat7));
    } else if (/19\s?%/.test(normText) || /19%/.test(category)) {
      vat19 = round2(gross * 19 / 119);
      vat7 = 0;
      vat0 = 0;
      net = round2(Math.max(0, gross - vat19));
    } else {
      vat19 = round2(gross * 19 / 119);
      vat7 = 0;
      vat0 = 0;
      net = round2(Math.max(0, gross - vat19));
    }
  }

  return {
    gross,
    net: round2(Math.max(0, net)),
    vat19: round2(Math.max(0, vat19)),
    vat7: round2(Math.max(0, vat7)),
    vat0: round2(Math.max(0, vat0)),
    source,
    scaleCorrected
  };
}

function shouldProcessRow(type: string, tax: string): boolean {
  const normalizedType = normalize(type);
  const normalizedTax = normalize(tax);
  return normalizedType === 'unklar' || !normalizedType || normalizedTax === 'unklar' || !normalizedTax;
}

function valueEquals(current: unknown, next: unknown): boolean {
  if (typeof current === 'number' || typeof next === 'number') {
    const a = parseAmount(current);
    const b = parseAmount(next);
    return Math.abs(a - b) < 0.0001;
  }
  return String(current ?? '').trim() === String(next ?? '').trim();
}

function pushUpdate(
  updates: Array<{ range: string; values: Array<Array<string | number>> }>,
  rowNumber: number,
  colIndex: number,
  current: unknown,
  next: string | number
): boolean {
  if (colIndex < 0) return false;
  if (valueEquals(current, next)) return false;
  updates.push({
    range: `Buchhaltung_DB!${colLetter(colIndex)}${rowNumber}`,
    values: [[next]]
  });
  return true;
}

function parseExistingNumber(row: RawRow, index: number): number {
  if (index < 0) return 0;
  return parseAmount(row[index]);
}

function flowHintFromName(rawName: string): FlowHint {
  const name = normalize(rawName);
  if (name.includes('einnahmen')) return 'Einnahmen';
  if (name.includes('ausgaben')) return 'Ausgaben';
  if (name.includes('einnahme')) return 'Einnahmen';
  if (name.includes('ausgabe')) return 'Ausgaben';
  return '';
}

async function resolveFlowHintFromFolderId(
  folderId: string,
  cache: Map<string, FlowHint>
): Promise<FlowHint> {
  const id = String(folderId || '').trim();
  if (!id) return '';
  if (cache.has(id)) return cache.get(id) || '';

  let hint: FlowHint = '';
  try {
    const folder = await withApiRetry(
      `drive.files.get.folder.${id}`,
      () => drive.files.get({
        fileId: id,
        fields: 'id,name,parents,mimeType',
        supportsAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    const mime = String(folder.data.mimeType || '');
    if (mime === 'application/vnd.google-apps.folder') {
      hint = flowHintFromName(String(folder.data.name || ''));
      const parentId = String(folder.data.parents?.[0] || '').trim();
      if (!hint && parentId) {
        const parent = await withApiRetry(
          `drive.files.get.folder_parent.${parentId}`,
          () => drive.files.get({
            fileId: parentId,
            fields: 'id,name,mimeType',
            supportsAllDrives: true
          }, {
            timeout: REQUEST_TIMEOUT_MS
          })
        );
        hint = flowHintFromName(String(parent.data.name || ''));
      }
    }
  } catch {
    hint = '';
  }

  cache.set(id, hint);
  return hint;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const runStart = Date.now();

  const [{ headers: dbHeaders, rows: dbRows }, { headers: belegeHeaders, rows: belegeRows }] = await Promise.all([
    readSheet('Buchhaltung_DB'),
    readSheet('belege')
  ]);

  if (dbHeaders.length === 0) throw new Error('Buchhaltung_DB is missing headers');

  const dIdx = (name: string): number => findHeader(dbHeaders, name);
  const bIdx = (name: string): number => findHeader(belegeHeaders, name);

  const idxDrive = dIdx('drive_file_id');
  const idxType = dIdx('belegart');
  const idxTax = dIdx('steuerkategorie');
  const idxName = dIdx('dateiname_original');
  const idxNormName = dIdx('dateiname_standardisiert');
  const idxSupplier = dIdx('lieferant');
  const idxInvoiceNo = dIdx('belegnr');
  const idxDate = dIdx('belegdatum');
  const idxMw19 = dIdx('mwst_19_betrag');
  const idxMw7 = dIdx('mwst_7_betrag');
  const idxMw0 = dIdx('mwst_0_betrag');
  const idxNet = dIdx('netto_gesamt');
  const idxGross = dIdx('brutto_gesamt');
  const idxBizVat = dIdx('geschaeftliche_mwst');
  const idxPrivVat = dIdx('private_mwst');
  const idxBizGross = dIdx('geschaeftlicher_anteil_brutto');
  const idxPrivGross = dIdx('privater_anteil_brutto');
  const idxStatus = dIdx('status');
  const idxHint = dIdx('hinweis');
  const idxAnalyzedAt = dIdx('analyzed_at');
  const idxSourceFolder = dIdx('source_folder_id');
  const idxTargetFolder = dIdx('target_folder_id');

  if (idxDrive < 0 || idxType < 0 || idxTax < 0 || idxGross < 0) {
    throw new Error('Buchhaltung_DB missing required columns');
  }

  const bDrive = bIdx('drive_file_id');
  const bName = bIdx('original_name');
  const bExtracted = bIdx('extracted_text');
  const bOcr = bIdx('ocr_text');
  const bMeta = bIdx('metadata');

  const belegeByDrive = new Map<string, RowObj>();
  for (const row of belegeRows) {
    const driveId = String(row[bDrive] ?? '').trim();
    if (!driveId) continue;
    belegeByDrive.set(driveId, rowToObject(belegeHeaders, row));
  }

  const updates: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  const processed: ProcessedRow[] = [];
  const folderFlowHintCache = new Map<string, FlowHint>();

  let unresolvedBefore = 0;
  let unresolvedAfter = 0;
  let resolvedIncome = 0;
  let resolvedExpense = 0;
  let nonTransactionMarked = 0;
  let lowConfidenceSkipped = 0;
  let scaleFixes = 0;
  let rowsWithoutBelegeContext = 0;

  for (let rowIndex = 0; rowIndex < dbRows.length; rowIndex++) {
    if (processed.length >= BATCH_SIZE) break;
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) break;

    const row = dbRows[rowIndex];
    const rowNumber = rowIndex + 2;
    const driveId = String(row[idxDrive] ?? '').trim();
    if (!driveId) continue;

    const currentType = String(row[idxType] ?? '').trim();
    const currentTax = String(row[idxTax] ?? '').trim();
    if (!shouldProcessRow(currentType, currentTax)) continue;
    unresolvedBefore += 1;

    const beleg = belegeByDrive.get(driveId);
    if (!beleg) rowsWithoutBelegeContext += 1;

    const meta = parseMetadata(beleg?.metadata || row[dIdx('metadata')] || '');

    const originalName = String(row[idxName] ?? beleg?.original_name ?? '').trim();
    const stdName = String(row[idxNormName] ?? '').trim();
    const belegeName = String(beleg?.original_name || '').trim();
    const extractedText = String(beleg?.extracted_text || '').trim();
    const ocrText = String(beleg?.ocr_text || '').trim();

    const allText = [originalName, stdName, belegeName, extractedText, ocrText, String(meta.supplier || ''), String(meta.tax_category || '')]
      .filter((part) => part.length > 0)
      .join('\n');

    const folderTarget = String(beleg?.target_folder_id || row[idxTargetFolder] || '').trim();
    const folderSource = String(beleg?.source_folder_id || row[idxSourceFolder] || '').trim();
    let folderFlowHint = await resolveFlowHintFromFolderId(folderTarget, folderFlowHintCache);
    if (!folderFlowHint) {
      folderFlowHint = await resolveFlowHintFromFolderId(folderSource, folderFlowHintCache);
    }

    const classification = classify({
      existingType: currentType,
      existingTax: currentTax,
      allText,
      nameText: [originalName, stdName, belegeName].join(' '),
      metadata: meta,
      folderFlowHint
    });

    let finalClassification: Classification = classification;
    const existingGross = parseExistingNumber(row, idxGross);
    const grossSignal = Math.max(existingGross, parseAmount(meta.gross_total), detectPrimaryGross(allText));
    if (!classification.nonTransaction && classification.belegart === 'Unklar' && grossSignal > 0) {
      const normText = normalize(allText);
      const strongIncome = /(abschlagsrechnung|teilrechnung|schlussrechnung).{0,80}angebot|zukunfts\\s*-?\\s*orientierte\\s*energie|kundenservice\\s*:\\s*\\d/.test(normText);
      const strongExpense = /rechnung\\s*an\\s*:\\s*(zoe|jeremy)|receipt|bon-id|kassenbon|quittung|kraftstoff|benzin|diesel|tankstelle|myhammer|obeta|bauhaus|obi|ionos|telekom|vodafone|openai|amazon|rankingcoach|fielmann|lohnschein/.test(normText);
      const fallbackType: Belegart = (strongIncome && !strongExpense) ? 'Einnahme' : 'Ausgabe';
      const fallbackTax = fallbackType === 'Einnahme'
        ? (classification.steuerkategorie || 'Einnahmen 19%')
        : (classification.steuerkategorie && !classification.steuerkategorie.startsWith('Einnahmen') && classification.steuerkategorie !== 'Nicht EUR-relevant (Archiv)'
          ? classification.steuerkategorie
          : 'Sonstige Ausgaben');
      finalClassification = {
        ...classification,
        belegart: fallbackType,
        steuerkategorie: fallbackTax,
        confidence: Math.max(classification.confidence, 0.66),
        reasons: [...classification.reasons, 'F:nonzero_fallback_classification']
      };
    }

    const shouldWriteClass = finalClassification.nonTransaction
      || (finalClassification.belegart !== 'Unklar' && finalClassification.confidence >= MIN_CONFIDENCE);

    if (!shouldWriteClass) {
      unresolvedAfter += 1;
      lowConfidenceSkipped += 1;
      continue;
    }

    const amountResolution = resolveAmounts({
      classification: finalClassification,
      existingGross,
      existingVat19: parseExistingNumber(row, idxMw19),
      existingVat7: parseExistingNumber(row, idxMw7),
      existingVat0: parseExistingNumber(row, idxMw0),
      existingNet: parseExistingNumber(row, idxNet),
      text: allText,
      metadata: meta
    });

    if (finalClassification.nonTransaction) nonTransactionMarked += 1;
    if (amountResolution.scaleCorrected) scaleFixes += 1;

    const inferredSupplier = String(meta.supplier || '').trim() || inferSupplier(allText, originalName);
    const inferredInvoiceNo = String(meta.invoice_no || '').trim() || parseInvoiceNo(allText);
    const inferredDate = String(meta.invoice_date || '').trim() || parseDateIso(allText) || parseDateIso(originalName);

    const beforeType = currentType || 'Unklar';
    const afterType = finalClassification.belegart;
    const beforeTax = currentTax;
    const afterTax = finalClassification.steuerkategorie || currentTax || 'Unklar';

    let changed = false;

    changed = pushUpdate(updates, rowNumber, idxType, row[idxType], afterType) || changed;
    changed = pushUpdate(updates, rowNumber, idxTax, row[idxTax], afterTax) || changed;

    if (idxSupplier >= 0 && !hasValue(row[idxSupplier])) {
      changed = pushUpdate(updates, rowNumber, idxSupplier, row[idxSupplier], inferredSupplier) || changed;
    }
    if (idxInvoiceNo >= 0 && !hasValue(row[idxInvoiceNo]) && inferredInvoiceNo) {
      changed = pushUpdate(updates, rowNumber, idxInvoiceNo, row[idxInvoiceNo], inferredInvoiceNo) || changed;
    }
    if (idxDate >= 0 && !hasValue(row[idxDate]) && inferredDate) {
      changed = pushUpdate(updates, rowNumber, idxDate, row[idxDate], inferredDate) || changed;
    }

    changed = pushUpdate(updates, rowNumber, idxGross, row[idxGross], amountResolution.gross) || changed;
    changed = pushUpdate(updates, rowNumber, idxNet, row[idxNet], amountResolution.net) || changed;
    changed = pushUpdate(updates, rowNumber, idxMw19, row[idxMw19], amountResolution.vat19) || changed;
    changed = pushUpdate(updates, rowNumber, idxMw7, row[idxMw7], amountResolution.vat7) || changed;
    changed = pushUpdate(updates, rowNumber, idxMw0, row[idxMw0], amountResolution.vat0) || changed;

    const isPrivateExpense = afterType === 'Ausgabe' && normalize(afterTax).includes('privat');
    const businessGross = isPrivateExpense ? 0 : amountResolution.gross;
    const privateGross = isPrivateExpense ? amountResolution.gross : 0;
    const businessVat = isPrivateExpense ? 0 : round2(amountResolution.vat19 + amountResolution.vat7);

    changed = pushUpdate(updates, rowNumber, idxBizGross, row[idxBizGross], businessGross) || changed;
    changed = pushUpdate(updates, rowNumber, idxPrivGross, row[idxPrivGross], privateGross) || changed;
    changed = pushUpdate(updates, rowNumber, idxBizVat, row[idxBizVat], businessVat) || changed;
    changed = pushUpdate(updates, rowNumber, idxPrivVat, row[idxPrivVat], 0) || changed;

    const noteParts = [
      `resolver_conf=${finalClassification.confidence.toFixed(2)}`,
      `income_score=${finalClassification.incomeScore}`,
      `expense_score=${finalClassification.expenseScore}`,
      `non_transaction=${toBoolText(finalClassification.nonTransaction)}`,
      `gross_source=${amountResolution.source}`
    ];
    const reasonText = finalClassification.reasons.slice(0, 6).join(',');
    if (reasonText) noteParts.push(`reasons=${reasonText}`);
    const hintText = noteParts.join('; ').slice(0, 480);

    if (idxHint >= 0) {
      changed = pushUpdate(updates, rowNumber, idxHint, row[idxHint], hintText) || changed;
    }
    if (idxStatus >= 0) {
      const status = finalClassification.nonTransaction
        ? 'non_transaction_doc'
        : (finalClassification.belegart === 'Unklar' ? 'pending_review' : 'resolved_unclear');
      changed = pushUpdate(updates, rowNumber, idxStatus, row[idxStatus], status) || changed;
    }
    if (idxAnalyzedAt >= 0) {
      changed = pushUpdate(updates, rowNumber, idxAnalyzedAt, row[idxAnalyzedAt], new Date().toISOString()) || changed;
    }

    if (!changed) continue;

    if (finalClassification.belegart === 'Einnahme') resolvedIncome += 1;
    if (finalClassification.belegart === 'Ausgabe') resolvedExpense += 1;
    if (finalClassification.belegart === 'Unklar') unresolvedAfter += 1;

    processed.push({
      rowNumber,
      driveId,
      beforeType,
      afterType,
      beforeTax,
      afterTax,
      confidence: finalClassification.confidence,
      nonTransaction: finalClassification.nonTransaction,
      grossBefore: existingGross,
      grossAfter: amountResolution.gross,
      scaleCorrected: amountResolution.scaleCorrected,
      reasons: finalClassification.reasons.slice(0, 8).join(',')
    });
  }

  if (APPLY_UPDATES && updates.length > 0) {
    for (let i = 0; i < updates.length; i += 300) {
      const chunk = updates.slice(i, i + 300);
      await withApiRetry(
        `sheets.values.batchUpdate.${i / 300}`,
        () => sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: chunk
          }
        }, {
          timeout: REQUEST_TIMEOUT_MS
        })
      );
    }
  }

  const lines: string[] = [];
  lines.push('# MICRO Resolve Unklar');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Apply updates: ${APPLY_UPDATES}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Min confidence: ${MIN_CONFIDENCE}`);
  lines.push(`- Unklar candidates touched: ${unresolvedBefore}`);
  lines.push(`- Processed rows (changed): ${processed.length}`);
  lines.push(`- Resolved to Einnahme: ${resolvedIncome}`);
  lines.push(`- Resolved to Ausgabe: ${resolvedExpense}`);
  lines.push(`- Marked non transaction: ${nonTransactionMarked}`);
  lines.push(`- Still unresolved: ${unresolvedAfter}`);
  lines.push(`- Scale corrections: ${scaleFixes}`);
  lines.push(`- Low confidence skipped: ${lowConfidenceSkipped}`);
  lines.push(`- Missing belege context: ${rowsWithoutBelegeContext}`);
  lines.push(`- Cell updates: ${updates.length}`);
  lines.push('');
  lines.push('| row | drive_file_id | before_type | after_type | before_tax | after_tax | confidence | non_transaction | gross_before | gross_after | scale_fix | reasons |');
  lines.push('|---:|---|---|---|---|---|---:|---|---:|---:|---|---|');
  for (const item of processed.slice(0, 250)) {
    lines.push(`| ${item.rowNumber} | ${item.driveId} | ${item.beforeType} | ${item.afterType} | ${item.beforeTax} | ${item.afterTax} | ${item.confidence.toFixed(2)} | ${toBoolText(item.nonTransaction)} | ${item.grossBefore.toFixed(2)} | ${item.grossAfter.toFixed(2)} | ${toBoolText(item.scaleCorrected)} | ${item.reasons.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    apply: APPLY_UPDATES,
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    minConfidence: MIN_CONFIDENCE,
    unresolvedCandidates: unresolvedBefore,
    changedRows: processed.length,
    resolvedIncome,
    resolvedExpense,
    nonTransactionMarked,
    unresolvedAfter,
    scaleFixes,
    lowConfidenceSkipped,
    rowsWithoutBelegeContext,
    cellUpdates: updates.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_resolve_unclear', main).catch((error) => {
  console.error(error);
  process.exit(1);
});
