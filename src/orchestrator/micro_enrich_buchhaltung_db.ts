import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.MICRO_ENRICH_BATCH || '25', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.MICRO_ENRICH_RUN_BUDGET_MS || '170000', 10);
const OVERWRITE_FILLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_ENRICH_OVERWRITE || '0').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_ENRICH_BUCHHALTUNG_DB.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_ENRICH_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_ENRICH_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_ENRICH_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_ENRICH_API_RETRY_MAX_MS, 15000);
const MONEY_FIELDS = new Set([
  'mwst_19_betrag',
  'mwst_7_betrag',
  'mwst_0_betrag',
  'netto_gesamt',
  'brutto_gesamt',
  'geschaeftliche_mwst',
  'private_mwst',
  'geschaeftlicher_anteil_brutto',
  'privater_anteil_brutto'
]);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_enrich_buchhaltung_db'
  });
}

type RowObj = Record<string, string>;

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function colLetter(colIndex0: number): string {
  let n = colIndex0 + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseDateIso(text: string): string {
  const dmy = text.match(/\b([0-3]?\d)[.\-\/]([01]?\d)[.\-\/]((?:19|20)\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = text.match(/\b((?:19|20)\d{2})[.\-\/]([01]?\d)[.\-\/]([0-3]?\d)\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return '';
}

function parseInvoiceNo(text: string): string {
  const m = text.match(/(?:rechnungs?nr\.?|rechnung\s*nr\.?|invoice\s*no\.?|belegnr\.?)\s*[:#]?\s*([A-Za-z0-9.\-_/]{4,})/i);
  if (m?.[1]) return m[1];
  const m2 = text.match(/\b\d{4}\.\d+\.\d+\b/);
  return m2?.[0] || '';
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.\-]/g, '')
    .trim();
  if (!cleaned) return 0;

  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/-/g, '');
  if (!unsigned) return 0;

  const hasComma = unsigned.includes(',');
  const hasDot = unsigned.includes('.');
  let normalized = unsigned;
  if (hasComma && hasDot) {
    normalized = unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.')
      ? unsigned.replace(/\./g, '').replace(/,/g, '.')
      : unsigned.replace(/,/g, '');
  } else if (hasComma) {
    const lastComma = unsigned.lastIndexOf(',');
    const frac = unsigned.slice(lastComma + 1);
    if (frac.length === 2) normalized = `${unsigned.slice(0, lastComma).replace(/[.,]/g, '')}.${frac}`;
    else if (unsigned.split(',').length === 2 && frac.length === 3) normalized = unsigned.replace(/,/g, '');
    else normalized = unsigned.replace(/,/g, '.');
  } else if (hasDot) {
    const lastDot = unsigned.lastIndexOf('.');
    const frac = unsigned.slice(lastDot + 1);
    if (frac.length === 2) normalized = `${unsigned.slice(0, lastDot).replace(/\./g, '')}.${frac}`;
    else if (unsigned.split('.').length === 2 && frac.length === 3) normalized = unsigned.replace(/\./g, '');
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? sign * n : 0;
}

function parseAmounts(text: string): number[] {
  const matches = [...text.matchAll(/\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/g)].map((m) => m[1]);
  const values: number[] = [];
  for (const raw of matches) {
    const n = parseAmount(raw);
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function detectPrimaryGross(text: string, amounts: number[]): number {
  const patterns = [
    /(?:gesamt(?:betrag)?|summe|zahlbetrag|brutto)[^\d\-]{0,20}([\-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /(?:total)[^\d\-]{0,20}([\-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseAmount(match[1]);
      if (Number.isFinite(value) && value > 0) return round2(value);
    }
  }
  const positives = amounts.filter((n) => Number.isFinite(n) && n > 0 && n < 100000);
  if (positives.length === 0) return 0;
  return round2(Math.max(...positives));
}

function inferSupplier(text: string, originalName: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 3);
  const bad = ['rechnung', 'invoice', 'quittung', 'beleg', 'mwst', 'ust-id', 'summe'];
  for (const line of lines.slice(0, 20)) {
    const low = line.toLowerCase();
    if (bad.some((b) => low.includes(b))) continue;
    if (/\d{2,}/.test(low) && line.length < 8) continue;
    if (line.length > 2 && line.length < 80) return line;
  }
  const base = originalName.replace(/\.[A-Za-z0-9]{2,6}$/i, '').replace(/[_\-]+/g, ' ').trim();
  return base.slice(0, 80);
}

function inferBelegartAndTaxCategory(text: string): { belegart: string; steuerkategorie: string } {
  const t = normalize(text);
  const owner = /zoe solar|jeremy schulze/.test(t);
  const invoice = /rechnung|abschlagsrechnung|schlussrechnung|teilrechnung|invoice/.test(t);
  const fuel = /kraftstoff|benzin|diesel|tankstelle|super e5|super e10/.test(t);
  const material = /modul|wechselrichter|pv-anlage|solarmodul|montage|kabel|schraube|baumarkt|ob[i1]/.test(t);
  const telco = /ionos|1&1|telekom|vodafone|hosting|domain|adobe|apple|icloud/.test(t);
  const insurance = /versicherung|hdi|arag/.test(t);
  const privateMarkers = /lidl|rewe|edeka|wolt|lieferando|netflix|apotheke|tierfutter|drogerie|lebensmittel/.test(t);

  if (owner && invoice) {
    if (/0\s?%|umsatzsteuerfrei|steuerfrei/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 0% PV' };
    if (/19\s?%/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 19%' };
    if (/7\s?%/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 7%' };
    return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen' };
  }

  if (privateMarkers && !fuel) return { belegart: 'Ausgabe', steuerkategorie: 'Privat/Nicht abzugsfähig' };
  if (fuel) return { belegart: 'Ausgabe', steuerkategorie: 'Kraftstoff/Benzin' };
  if (material) return { belegart: 'Ausgabe', steuerkategorie: 'Material/PV' };
  if (telco) return { belegart: 'Ausgabe', steuerkategorie: 'Telekommunikation/IT' };
  if (insurance) return { belegart: 'Ausgabe', steuerkategorie: 'Versicherung' };
  return { belegart: 'Ausgabe', steuerkategorie: 'Sonstige Ausgaben' };
}

function hasAnyValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function setField(row: RowObj, key: string, value: string): void {
  if (!(key in row)) return;
  const current = row[key];
  if (OVERWRITE_FILLED || !hasAnyValue(current)) row[key] = value;
}

function parseMoneyCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return round2(value);
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = parseAmount(text);
  if (!Number.isFinite(parsed)) return null;
  return round2(parsed);
}

function setMoneyField(row: RowObj, key: string, computedValue: number): void {
  if (!(key in row)) return;
  const currentRaw = row[key];
  const currentParsed = parseMoneyCell(currentRaw);
  const currentFilled = hasAnyValue(currentRaw);
  const next = round2(computedValue);
  if (!OVERWRITE_FILLED && currentFilled) {
    row[key] = String(currentParsed ?? next);
    return;
  }
  row[key] = String(next);
}

async function readSheet(tab: string): Promise<{ headers: string[]; rows: Array<Array<string | number>> }> {
  const r = await withApiRetry(
    `sheets.values.get.${tab}`,
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A1:AZ`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const values = (r.data.values || []) as Array<Array<string | number>>;
  const headers = (values[0] || []).map((v) => String(v || '').trim());
  return { headers, rows: values.slice(1) };
}

async function ensureBuchhaltungDbHeaders(): Promise<string[]> {
  const { headers } = await readSheet('Buchhaltung_DB');
  if (headers.length > 0) return headers;
  const defaultHeaders = [
    'drive_file_id', 'file_url', 'dateiname_original', 'dateiname_standardisiert',
    'belegart', 'lieferant', 'kunde', 'belegnr', 'beleg_id', 'belegdatum', 'leistungsdatum',
    'steuerkategorie', 'mwst_19_betrag', 'mwst_7_betrag', 'mwst_0_betrag',
    'netto_gesamt', 'brutto_gesamt', 'geschaeftliche_mwst', 'private_mwst',
    'geschaeftlicher_anteil_brutto', 'privater_anteil_brutto', 'sollkonto', 'habenkonto',
    'iban', 'bic', 'bankleitzahl', 'hinweis', 'duplikat_gruppe', 'status', 'line_items_json',
    'source_folder_id', 'target_folder_id', 'analyzed_at'
  ];
  await withApiRetry(
    'sheets.values.update.buchhaltung_db_header',
    () => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Buchhaltung_DB!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [defaultHeaders] }
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  return defaultHeaders;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const runStart = Date.now();

  const [{ headers: belegeHeaders, rows: belegeRows }, buchHeaders] = await Promise.all([
    readSheet('belege'),
    ensureBuchhaltungDbHeaders()
  ]);
  const { rows: buchRows } = await readSheet('Buchhaltung_DB');

  const belegeMapHeader = new Map<string, number>();
  belegeHeaders.forEach((h, i) => belegeMapHeader.set(String(h || '').trim(), i));
  const buchMapHeader = new Map<string, number>();
  buchHeaders.forEach((h, i) => buchMapHeader.set(String(h || '').trim(), i));

  const bIdx = (name: string) => belegeMapHeader.get(name) ?? -1;
  const dIdx = (name: string) => buchMapHeader.get(name) ?? -1;

  const belegeByDrive = new Map<string, RowObj>();
  for (const row of belegeRows) {
    const id = String(row[bIdx('drive_file_id')] || '').trim();
    if (!id) continue;
    const obj: RowObj = {};
    belegeHeaders.forEach((h, i) => (obj[h] = String(row[i] || '')));
    belegeByDrive.set(id, obj);
  }

  const dbRowByDrive = new Map<string, { rowNumber: number; row: RowObj }>();
  for (let i = 0; i < buchRows.length; i++) {
    const row = buchRows[i];
    const id = String(row[dIdx('drive_file_id')] || '').trim();
    if (!id) continue;
    const obj: RowObj = {};
    buchHeaders.forEach((h, c) => (obj[h] = String(row[c] || '')));
    dbRowByDrive.set(id, { rowNumber: i + 2, row: obj });
  }

  const candidates = Array.from(belegeByDrive.entries())
    .filter(([driveId, b]) => {
      const db = dbRowByDrive.get(driveId)?.row;
      const text = `${b.extracted_text || ''}\n${b.ocr_text || ''}`.trim();
      const hasText = text.length >= 20;
      if (!hasText) return false;
      if (!db) return true;
      const status = normalize(db.status || '');
      const taxCategory = normalize(db.steuerkategorie || '');
      // Keep manually resolved rows stable and avoid re-injecting archive/non-transaction docs.
      if (status === 'non_transaction_doc' || status === 'resolved_unclear' || status === 'manual_lock') return false;
      if (taxCategory.includes('nicht eur-relevant')) return false;
      const hasCore = !!(db.belegart && db.steuerkategorie && db.brutto_gesamt && db.lieferant);
      return !hasCore || status === 'pending';
    })
    .slice(0, Math.max(1, BATCH_SIZE));

  const updates: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  const appends: Array<Array<string | number>> = [];
  const processed: Array<{ drive_file_id: string; action: string; belegart: string; steuerkategorie: string }> = [];
  let skippedBudget = 0;

  for (const [driveId, b] of candidates) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      skippedBudget += 1;
      continue;
    }
    const text = `${String(b.extracted_text || '')}\n${String(b.ocr_text || '')}`.trim();
    const norm = normalize(`${b.original_name || ''}\n${text}`);
    const invoiceNo = parseInvoiceNo(text);
    const belegdatum = parseDateIso(text) || parseDateIso(b.original_name || '');
    const amounts = parseAmounts(text);
    const brutto = detectPrimaryGross(text, amounts);

    const tax = inferBelegartAndTaxCategory(norm);
    const has19 = /19\s?%/.test(norm);
    const has7 = /7\s?%/.test(norm) && !has19;
    const has0 = /0\s?%|steuerfrei|umsatzsteuerfrei/.test(norm);

    let mwst19 = 0;
    let mwst7 = 0;
    let mwst0 = 0;
    if (has19 && brutto > 0) mwst19 = round2(brutto * 19 / 119);
    if (has7 && brutto > 0) mwst7 = round2(brutto * 7 / 107);
    if (has0 && brutto > 0) mwst0 = round2(brutto);
    const netto = round2(Math.max(0, brutto - mwst19 - mwst7));

    const supplier = inferSupplier(text, b.original_name || '');
    const nowIso = new Date().toISOString();

    const existing = dbRowByDrive.get(driveId);
    const rowObj: RowObj = existing?.row ? { ...existing.row } : Object.fromEntries(buchHeaders.map((h) => [h, '']));

    setField(rowObj, 'drive_file_id', driveId);
    setField(rowObj, 'file_url', b.file_url || '');
    setField(rowObj, 'dateiname_original', b.original_name || '');
    setField(rowObj, 'dateiname_standardisiert', b.original_name || '');
    setField(rowObj, 'belegart', tax.belegart);
    setField(rowObj, 'lieferant', supplier);
    setField(rowObj, 'belegnr', invoiceNo);
    setField(rowObj, 'beleg_id', rowObj.beleg_id || randomUUID());
    setField(rowObj, 'belegdatum', belegdatum);
    setField(rowObj, 'leistungsdatum', rowObj.leistungsdatum || belegdatum);
    setField(rowObj, 'steuerkategorie', tax.steuerkategorie);
    setMoneyField(rowObj, 'mwst_19_betrag', mwst19);
    setMoneyField(rowObj, 'mwst_7_betrag', mwst7);
    setMoneyField(rowObj, 'mwst_0_betrag', mwst0);
    setMoneyField(rowObj, 'netto_gesamt', netto);
    setMoneyField(rowObj, 'brutto_gesamt', brutto);
    setMoneyField(rowObj, 'geschaeftliche_mwst', mwst19 + mwst7);
    setMoneyField(rowObj, 'private_mwst', 0);
    setMoneyField(rowObj, 'geschaeftlicher_anteil_brutto', brutto);
    setMoneyField(rowObj, 'privater_anteil_brutto', 0);
    setField(rowObj, 'status', 'pending_review');
    setField(rowObj, 'line_items_json', rowObj.line_items_json || '[]');
    setField(rowObj, 'source_folder_id', b.source_folder_id || '');
    setField(rowObj, 'target_folder_id', b.target_folder_id || '');
    setField(rowObj, 'analyzed_at', nowIso);

    const rowValues = buchHeaders.map((h) => {
      const raw = rowObj[h];
      if (raw === null || raw === undefined) return '';
      const maybeMoney = parseMoneyCell(raw);
      if (maybeMoney !== null && MONEY_FIELDS.has(h)) {
        return maybeMoney;
      }
      return typeof raw === 'number' ? raw : String(raw);
    });
    if (existing?.rowNumber) {
      const endCol = colLetter(buchHeaders.length - 1);
      updates.push({ range: `Buchhaltung_DB!A${existing.rowNumber}:${endCol}${existing.rowNumber}`, values: [rowValues] });
      processed.push({ drive_file_id: driveId, action: 'update', belegart: rowObj.belegart || '', steuerkategorie: rowObj.steuerkategorie || '' });
    } else {
      appends.push(rowValues);
      processed.push({ drive_file_id: driveId, action: 'append', belegart: rowObj.belegart || '', steuerkategorie: rowObj.steuerkategorie || '' });
    }
  }

  if (updates.length > 0) {
    await withApiRetry(
      'sheets.values.batchUpdate.buchhaltung_db',
      () => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updates }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }
  if (appends.length > 0) {
    await withApiRetry(
      'sheets.values.append.buchhaltung_db',
      () => sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Buchhaltung_DB!A1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appends }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }

  const lines: string[] = [];
  lines.push('# MICRO Enrich Buchhaltung_DB');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Candidates: ${candidates.length}`);
  lines.push(`- Skipped due budget: ${skippedBudget}`);
  lines.push(`- Updated rows: ${updates.length}`);
  lines.push(`- Appended rows: ${appends.length}`);
  lines.push('');
  lines.push('| drive_file_id | action | belegart | steuerkategorie |');
  lines.push('|---|---|---|---|');
  for (const p of processed) {
    lines.push(`| ${p.drive_file_id} | ${p.action} | ${p.belegart} | ${p.steuerkategorie} |`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    elapsedMs: Date.now() - runStart,
    candidates: candidates.length,
    skippedBudget,
    updatedRows: updates.length,
    appendedRows: appends.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_enrich_buchhaltung_db', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
