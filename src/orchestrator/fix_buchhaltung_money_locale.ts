import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const APPLY_CHANGES = !['0', 'false', 'no', 'off'].includes(String(process.env.MONEY_FIX_APPLY || '1').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'FIX_BUCHHALTUNG_MONEY_LOCALE.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MONEY_FIX_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MONEY_FIX_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MONEY_FIX_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MONEY_FIX_API_RETRY_MAX_MS, 15000);

const MONEY_COLUMNS = [
  'mwst_19_betrag',
  'mwst_7_betrag',
  'mwst_0_betrag',
  'netto_gesamt',
  'brutto_gesamt',
  'geschaeftliche_mwst',
  'private_mwst',
  'geschaeftlicher_anteil_brutto',
  'privater_anteil_brutto'
];

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

type CellUpdate = { row: number; col: string; key: string; before: unknown; after: number; reason: string };

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'fix_buchhaltung_money_locale'
  });
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.\-]/g, '')
    .trim();
  if (!cleaned) return Number.NaN;
  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/-/g, '');
  if (!unsigned) return Number.NaN;

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
    if (frac.length === 2) normalized = `${unsigned.slice(0, pos).replace(/[.,]/g, '')}.${frac}`;
    else if (unsigned.split(',').length === 2 && frac.length === 3) normalized = unsigned.replace(/,/g, '');
    else normalized = unsigned.replace(/,/g, '.');
  } else if (hasDot) {
    const pos = unsigned.lastIndexOf('.');
    const frac = unsigned.slice(pos + 1);
    if (frac.length === 2) normalized = `${unsigned.slice(0, pos).replace(/\./g, '')}.${frac}`;
    else if (unsigned.split('.').length === 2 && frac.length === 3) normalized = unsigned.replace(/\./g, '');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? sign * parsed : Number.NaN;
}

function parseDayMonthDecimal(raw: string): number | null {
  const clean = String(raw || '').trim();
  const m = clean.match(/^([0-3]?\d)[.,](\d{2})$/);
  if (!m) return null;
  const value = Number.parseFloat(`${m[1]}.${m[2]}`);
  if (!Number.isFinite(value)) return null;
  return round2(value);
}

function toComparable(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return round2(value);
  if (value === null || value === undefined) return null;
  const parsed = parseAmount(String(value));
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const [unformatted, formatted] = await Promise.all([
    withApiRetry(
      'sheets.values.get.unformatted',
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Buchhaltung_DB!A1:AZ',
        valueRenderOption: 'UNFORMATTED_VALUE'
      }, { timeout: REQUEST_TIMEOUT_MS })
    ),
    withApiRetry(
      'sheets.values.get.formatted',
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Buchhaltung_DB!A1:AZ',
        valueRenderOption: 'FORMATTED_VALUE'
      }, { timeout: REQUEST_TIMEOUT_MS })
    )
  ]);

  const unValues = (unformatted.data.values || []) as Array<Array<string | number>>;
  const fmtValues = (formatted.data.values || []) as Array<Array<string | number>>;
  const headers = (unValues[0] || []).map((v) => String(v || '').trim());
  if (headers.length === 0) throw new Error('Buchhaltung_DB has no header row');

  const colByKey = new Map<string, number>();
  headers.forEach((h, i) => colByKey.set(h, i));

  const updates: CellUpdate[] = [];
  const counts = {
    textToNumber: 0,
    dateSerialToDecimal: 0
  };

  for (let r = 1; r < unValues.length; r++) {
    const unRow = unValues[r] || [];
    const fmtRow = fmtValues[r] || [];
    for (const key of MONEY_COLUMNS) {
      const ci = colByKey.get(key);
      if (typeof ci !== 'number') continue;
      const currentUn = unRow[ci];
      const currentFmt = String(fmtRow[ci] ?? '').trim();
      if (currentUn === undefined || currentUn === null || String(currentUn).trim() === '') continue;

      let target: number | null = null;
      let reason = '';

      if (typeof currentUn === 'number' && Number.isFinite(currentUn)) {
        const dayMonth = parseDayMonthDecimal(currentFmt);
        const looksLikeDateSerial = currentUn >= 20000 && currentUn <= 80000 && dayMonth !== null;
        if (looksLikeDateSerial && dayMonth !== null) {
          target = dayMonth;
          reason = 'date_serial_to_decimal';
        }
      } else {
        const parsed = parseAmount(String(currentUn));
        if (Number.isFinite(parsed)) {
          target = round2(parsed);
          reason = 'text_to_number';
        }
      }

      if (target === null) continue;
      const currentComparable = toComparable(currentUn);
      if (currentComparable !== null && currentComparable === target && typeof currentUn === 'number') continue;

      if (reason === 'text_to_number') counts.textToNumber += 1;
      if (reason === 'date_serial_to_decimal') counts.dateSerialToDecimal += 1;
      updates.push({
        row: r + 1,
        col: colLetter(ci),
        key,
        before: currentUn,
        after: target,
        reason
      });
    }
  }

  if (APPLY_CHANGES && updates.length > 0) {
    const data = updates.map((u) => ({
      range: `Buchhaltung_DB!${u.col}${u.row}`,
      values: [[u.after]]
    }));
    for (let i = 0; i < data.length; i += 300) {
      const chunk = data.slice(i, i + 300);
      await withApiRetry(
        `sheets.values.batchUpdate.${i / 300}`,
        () => sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: chunk
          }
        }, { timeout: REQUEST_TIMEOUT_MS })
      );
    }
  }

  const lines: string[] = [];
  lines.push('# Fix Buchhaltung Money Locale');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Apply changes: ${APPLY_CHANGES}`);
  lines.push(`- Candidate updates: ${updates.length}`);
  lines.push(`- Text -> number updates: ${counts.textToNumber}`);
  lines.push(`- Date-serial -> decimal updates: ${counts.dateSerialToDecimal}`);
  lines.push('');
  lines.push('| row | column | field | reason | before | after |');
  lines.push('|---:|---|---|---|---|---:|');
  for (const u of updates.slice(0, 200)) {
    lines.push(`| ${u.row} | ${u.col} | ${u.key} | ${u.reason} | ${String(u.before).replace(/\|/g, '/')} | ${u.after.toFixed(2)} |`);
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    apply: APPLY_CHANGES,
    updates: updates.length,
    counts,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('fix_buchhaltung_money_locale', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
