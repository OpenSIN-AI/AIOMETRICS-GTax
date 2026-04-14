# Context Fulltext

- source_path: src/orchestrator/micro_enrich_buchhaltung_db.ts
- source_sha256: c1cc29afe07d0f7071c3794aee35019617d92d4e51c1f975b0bfd5f34c4c1495
- chunk: 1/2

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.MICRO_ENRICH_BATCH || '25', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.MICRO_ENRICH_RUN_BUDGET_MS || '170000', 10);
const OVERWRITE_FILLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_ENRICH_OVERWRITE || '0').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_ENRICH_BUCHHALTUNG_DB.md');

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

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

function parseAmounts(text: string): number[] {
  const matches = [...text.matchAll(/\b(\d{1,6}(?:[.,]\d{3})*[.,]\d{2})\b/g)].map((m) => m[1]);
  const values: number[] = [];
  for (const raw of matches) {
    const sanitized = raw.includes(',') && raw.includes('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(',', '.');
    const n = Number.parseFloat(sanitized);
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

function setField(row: RowObj, key: string, value: string): void {
  if (!(key in row)) return;
  const current = String(row[key] || '');
  if (OVERWRITE_FILLED || !current) row[key] = value;
}

async function readSheet(tab: string): Promise<{ headers: string[]; rows: string[][] }> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:AZ`
  });
  const values = (r.data.values || []) as string[][];
  return { headers: values[0] || [], rows: values.slice(1) };
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
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [defaultHeaders] }
  });
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
      const hasCore = !!(db.belegart && db.steuerkategorie && db.brutto_gesamt && db.lieferant);
      return !hasCore || status === 'pending';
    })
    .slice(0, Math.max(1, BATCH_SIZE));

  const updates: Array<{ range: string; values: string[][] }> = [];
  const appends: string[][] = [];
  const processed: Array<{ drive_file_id: string; action: string; belegart: string; steuerkategorie: string }> = [];
  let skippedBudget = 0;

  for (const [driveId, b] of candidates) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      skippedBudget += 1;
      continue;
    }
    const text = `${b.extracted_text || ''}\n${b.ocr_text || ''}`.trim();
    const norm = normalize(`${b.original_name || ''}\n${text}`);
    const invoiceNo = parseInvoiceNo(text);
    const belegdatum = parseDateIso(text) || parseDateIso(b.original_name || '');
    const amounts = parseAmounts(text);
    const brutto = amounts.length ? Math.max(...amounts) : 0;

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
    setField(rowObj, 'mwst_19_betrag', mwst19 ? mwst19.toFixed(2) : rowObj.mwst_19_betrag || '0.00');
    setField(rowObj, 'mwst_7_betrag', mwst7 ? mwst7.toFixed(2) : rowObj.mwst_7_betrag || '0.00');
    setField(rowObj, 'mwst_0_betrag', mwst0 ? mwst0.toFixed(2) : rowObj.mwst_0_betrag || '0.00');
    setField(rowObj, 'netto_gesamt', netto ? netto.toFixed(2) : rowObj.netto_gesamt || '0.00');
    setField(rowObj, 'brutto_gesamt', brutto ? brutto.toFixed(2) : rowObj.brutto_gesamt || '0.00');
    setField(rowObj, 'geschaeftliche_mwst', (mwst19 + mwst7).toFixed(2));
    setField(rowObj, 'private_mwst', rowObj.private_mwst || '0.00');
    setField(rowObj, 'geschaeftlicher_anteil_brutto', brutto ? brutto.toFixed(2) : rowObj.geschaeftlicher_anteil_brutto || '0.00');
    setField(rowObj, 'privater_anteil_brutto', rowObj.privater_anteil_brutto || '0.00');
    setField(rowObj, 'status', 'pending_review');
    setField(rowObj, 'line_items_json', rowObj.line_items_json || '[]');
    setField(rowObj, 'source_folder_id', b.source_folder_id || '');
    setField(rowObj, 'target_folder_id', b.target_folder_id || '');
    setField(rowObj, 'analyzed_at', nowIso);

    const rowValues = buchHeaders.map((h) => String(rowObj[h] || ''));
    if (existing?.rowNumber) {
      const endCol = colLetter(buchHeaders.length - 1);
      updates.push({ range: `Buchhaltung_DB!A${existing.rowNumber}:${endCol}${existing.rowNumber}`, values: [rowValues] });
      processed.push({ drive_file_id: driveId, action: 'update', belegart: rowObj.belegart || '', steuerkategorie: rowObj.steuerkate
```
