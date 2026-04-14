import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.MICRO_KONTO_BATCH || '50', 10);
const RUN_BUDGET_MS = Number.parseInt(process.env.MICRO_KONTO_RUN_BUDGET_MS || '170000', 10);
const OVERWRITE = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_KONTO_OVERWRITE || '0').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_KONTO_ASSIGN.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_KONTO_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_KONTO_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_KONTO_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_KONTO_API_RETRY_MAX_MS, 15000);

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
    loggerPrefix: 'micro_konto_assign'
  });
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseNum(v: string): number {
  const raw = String(v || '').trim();
  const normalized = raw.includes(',') && raw.includes('.')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  const n = Number.parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
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

async function readDb(): Promise<string[][]> {
  const r = await withApiRetry(
    'sheets.values.get.buchhaltung_db',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Buchhaltung_DB!A1:AZ'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  return (r.data.values || []) as string[][];
}

async function ensureIstkontoColumn(headers: string[]): Promise<string[]> {
  if (headers.includes('istkonto')) return headers;
  const updated = [...headers, 'istkonto'];
  await withApiRetry(
    'sheets.values.update.buchhaltung_db_header',
    () => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Buchhaltung_DB!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [updated] }
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  return updated;
}

function suggestKonten(belegart: string, steuerkategorie: string, mwst19: number, mwst7: number, mwst0: number): { sollkonto: string; habenkonto: string; istkonto: string } {
  const art = normalize(belegart);
  const cat = normalize(steuerkategorie);
  const bank = '1200';

  if (art === 'einnahme') {
    if (cat.includes('0%') || mwst0 > 0) return { sollkonto: bank, habenkonto: '8336', istkonto: bank }; // steuerfreie Umsätze (heuristisch)
    if (mwst19 > 0 || cat.includes('19')) return { sollkonto: bank, habenkonto: '8400', istkonto: bank }; // Erlöse 19%
    if (mwst7 > 0 || cat.includes('7')) return { sollkonto: bank, habenkonto: '8300', istkonto: bank }; // Erlöse 7%
    return { sollkonto: bank, habenkonto: '8400', istkonto: bank };
  }

  // Ausgabe
  if (cat.includes('kraftstoff')) return { sollkonto: '4530', habenkonto: bank, istkonto: bank };
  if (cat.includes('material') || cat.includes('pv')) return { sollkonto: '3400', habenkonto: bank, istkonto: bank };
  if (cat.includes('telekommunikation') || cat.includes('it')) return { sollkonto: '4920', habenkonto: bank, istkonto: bank };
  if (cat.includes('versicherung')) return { sollkonto: '4360', habenkonto: bank, istkonto: bank };
  if (cat.includes('miete')) return { sollkonto: '4210', habenkonto: bank, istkonto: bank };
  if (cat.includes('strom') || cat.includes('energie')) return { sollkonto: '4270', habenkonto: bank, istkonto: bank };
  if (cat.includes('privat')) return { sollkonto: '1800', habenkonto: bank, istkonto: bank };
  return { sollkonto: '4950', habenkonto: bank, istkonto: bank };
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const runStart = Date.now();
  let db = await readDb();
  if (db.length <= 1) {
    console.log(JSON.stringify({ status: 'ok', processed: 0, reason: 'empty_db' }, null, 2));
    return;
  }

  let headers = db[0];
  headers = await ensureIstkontoColumn(headers);
  db = await readDb();
  headers = db[0];
  const h = headers;
  const idx = (name: string) => h.indexOf(name);
  const iType = idx('belegart');
  const iTaxCat = idx('steuerkategorie');
  const iMw19 = idx('mwst_19_betrag');
  const iMw7 = idx('mwst_7_betrag');
  const iMw0 = idx('mwst_0_betrag');
  const iSoll = idx('sollkonto');
  const iHaben = idx('habenkonto');
  const iIst = idx('istkonto');
  const iStatus = idx('status');
  const iDrive = idx('drive_file_id');

  if ([iType, iTaxCat, iSoll, iHaben, iIst].some((x) => x < 0)) {
    throw new Error('Missing required Buchhaltung_DB columns for konto assignment');
  }

  const updates: Array<{ range: string; values: string[][] }> = [];
  const processed: Array<{ row: number; driveId: string; sollkonto: string; habenkonto: string; istkonto: string }> = [];
  let skippedBudget = 0;

  for (let r = 1; r < db.length; r++) {
    if (processed.length >= BATCH_SIZE) break;
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      skippedBudget += 1;
      continue;
    }
    const row = db[r];
    const driveId = String(row[iDrive] || '').trim();
    if (!driveId) continue;
    const status = normalize(String(row[iStatus] || ''));
    const steuerNormalized = normalize(String(row[iTaxCat] || ''));
    if (status === 'non_transaction_doc' || status === 'manual_lock') continue;
    if (steuerNormalized.includes('nicht eur-relevant')) continue;
    const currSoll = String(row[iSoll] || '').trim();
    const currHaben = String(row[iHaben] || '').trim();
    const currIst = String(row[iIst] || '').trim();
    if (!OVERWRITE && currSoll && currHaben && currIst) continue;

    const belegart = String(row[iType] || '').trim() || 'Ausgabe';
    const steuer = String(row[iTaxCat] || '').trim();
    const mw19 = parseNum(String(row[iMw19] || '0'));
    const mw7 = parseNum(String(row[iMw7] || '0'));
    const mw0 = parseNum(String(row[iMw0] || '0'));
    const suggestion = suggestKonten(belegart, steuer, mw19, mw7, mw0);

    const rowNum = r + 1;
    if (OVERWRITE || !currSoll) updates.push({ range: `Buchhaltung_DB!${colLetter(iSoll)}${rowNum}`, values: [[suggestion.sollkonto]] });
    if (OVERWRITE || !currHaben) updates.push({ range: `Buchhaltung_DB!${colLetter(iHaben)}${rowNum}`, values: [[suggestion.habenkonto]] });
    if (OVERWRITE || !currIst) updates.push({ range: `Buchhaltung_DB!${colLetter(iIst)}${rowNum}`, values: [[suggestion.istkonto]] });
    if (iStatus >= 0) updates.push({ range: `Buchhaltung_DB!${colLetter(iStatus)}${rowNum}`, values: [['konto_assigned']] });
    processed.push({ row: rowNum, driveId, sollkonto: suggestion.sollkonto, habenkonto: suggestion.habenkonto, istkonto: suggestion.istkonto });
  }

  if (updates.length > 0) {
    await withApiRetry(
      'sheets.values.batchUpdate.buchhaltung_db',
      () => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }

  const lines: string[] = [];
  lines.push('# MICRO Konto Assign');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Processed: ${processed.length}`);
  lines.push(`- Skipped due budget: ${skippedBudget}`);
  lines.push(`- Updates: ${updates.length}`);
  lines.push('');
  lines.push('| row | drive_file_id | sollkonto | habenkonto | istkonto |');
  lines.push('|---|---|---|---|---|');
  for (const p of processed) lines.push(`| ${p.row} | ${p.driveId} | ${p.sollkonto} | ${p.habenkonto} | ${p.istkonto} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    elapsedMs: Date.now() - runStart,
    processed: processed.length,
    skippedBudget,
    updates: updates.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_konto_assign', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
