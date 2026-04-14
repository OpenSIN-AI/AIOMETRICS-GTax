import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const TARGET_YEAR = parsePositiveInt(process.env.MICRO_REPAIR_TARGET_YEAR, 2023);
const APPLY = !['0', 'false', 'no', 'off'].includes(String(process.env.MICRO_REPAIR_APPLY || '1').toLowerCase());
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_REPAIR_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_REPAIR_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_REPAIR_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_REPAIR_API_RETRY_MAX_MS, 15000);
const REPORT_PATH = path.join(process.cwd(), 'docs', `MICRO_REPAIR_QUALITY_${TARGET_YEAR}.md`);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

type RowLike = Array<string | number>;
type Candidate<T> = { value: T | null; source: string };

interface FixSample {
  row: number;
  driveFileId: string;
  action: string;
  detail: string;
}

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_repair_quality_year'
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

function toNum(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseAmount(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2035) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toIso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function extractDates(input: string): string[] {
  const out: string[] = [];
  for (const match of input.matchAll(/\b([0-3]?\d)[.\-/]([01]?\d)[.\-/]((?:19|20)\d{2})\b/g)) {
    const d = Number.parseInt(match[1], 10);
    const m = Number.parseInt(match[2], 10);
    const y = Number.parseInt(match[3], 10);
    if (isValidDate(y, m, d)) out.push(toIso(y, m, d));
  }
  for (const match of input.matchAll(/\b((?:19|20)\d{2})[.\-/]([01]?\d)[.\-/]([0-3]?\d)\b/g)) {
    const y = Number.parseInt(match[1], 10);
    const m = Number.parseInt(match[2], 10);
    const d = Number.parseInt(match[3], 10);
    if (isValidDate(y, m, d)) out.push(toIso(y, m, d));
  }
  return Array.from(new Set(out));
}

function extractSingleDate(input: string): string | null {
  const dates = extractDates(input);
  return dates.length === 1 ? dates[0] : null;
}

function yearOfDateValue(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number.parseFloat(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + Math.floor(serial));
      return base.getUTCFullYear();
    }
  }
  const match = raw.match(/\b(20\d{2})\b/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  const ms = Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30);
  return Math.floor(ms / 86400000);
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function amountCandidate(meta: Record<string, unknown>, originalName: string, text: string): Candidate<number> {
  for (const key of ['gross_total', 'amount', 'total']) {
    const parsed = parseAmount(String(meta[key] ?? ''));
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 100000) {
      return { value: round2(parsed), source: `meta.${key}` };
    }
  }

  const nameEur = originalName.match(/(?:^|_)(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*EUR\b/i);
  if (nameEur?.[1]) {
    const parsed = parseAmount(nameEur[1]);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 100000) {
      return { value: round2(parsed), source: 'name.eur' };
    }
  }

  const anchored = text.match(/(?:gesamt(?:betrag)?|summe|zahlbetrag|endbetrag|brutto|total)[^\d\-]{0,20}([\-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i);
  if (anchored?.[1]) {
    const parsed = parseAmount(anchored[1]);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 100000) {
      return { value: round2(parsed), source: 'text.anchor' };
    }
  }

  return { value: null, source: '' };
}

function dateCandidate(meta: Record<string, unknown>, originalName: string, text: string): Candidate<string> {
  for (const key of ['invoice_date', 'date', 'belegdatum']) {
    const date = extractSingleDate(String(meta[key] ?? ''));
    if (date) return { value: date, source: `meta.${key}` };
  }

  const prefix = originalName.match(/^((?:19|20)\d{2})[-_.](\d{2})[-_.](\d{2})_/);
  if (prefix) {
    const y = Number.parseInt(prefix[1], 10);
    const m = Number.parseInt(prefix[2], 10);
    const d = Number.parseInt(prefix[3], 10);
    if (isValidDate(y, m, d)) return { value: toIso(y, m, d), source: 'name.prefix' };
  }

  const keyword = text.match(/(?:rechnungsdatum|belegdatum|leistungsdatum|datum)[^\d]{0,15}((?:[0-3]?\d[.\-/][01]?\d[.\-/](?:19|20)\d{2}|(?:19|20)\d{2}[.\-/][01]?\d[.\-/][0-3]?\d))/i);
  if (keyword?.[1]) {
    const date = extractSingleDate(keyword[1]);
    if (date) return { value: date, source: 'text.keyword' };
  }

  return { value: null, source: '' };
}

async function readSheet(tab: string): Promise<RowLike[]> {
  const response = await withApiRetry(
    `sheets.values.get.${tab}`,
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A1:AZ`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, { timeout: REQUEST_TIMEOUT_MS })
  );
  return (response.data.values || []) as RowLike[];
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const [db, belege] = await Promise.all([readSheet('Buchhaltung_DB'), readSheet('belege')]);
  if (db.length === 0) throw new Error('Buchhaltung_DB empty');
  if (belege.length === 0) throw new Error('belege empty');

  const dbHeaders = db[0].map((v) => String(v || '').trim());
  const belegeHeaders = belege[0].map((v) => String(v || '').trim());
  const dIdx = (name: string) => dbHeaders.indexOf(name);
  const bIdx = (name: string) => belegeHeaders.indexOf(name);

  const iDrive = dIdx('drive_file_id');
  const iDate = dIdx('belegdatum');
  const iLeistung = dIdx('leistungsdatum');
  const iGross = dIdx('brutto_gesamt');
  const iBizGross = dIdx('geschaeftlicher_anteil_brutto');
  const iStatus = dIdx('status');
  const iDup = dIdx('duplikat_gruppe');
  const iHint = dIdx('hinweis');

  const biDrive = bIdx('drive_file_id');
  const biName = bIdx('original_name');
  const biExt = bIdx('extracted_text');
  const biOcr = bIdx('ocr_text');
  const biMeta = bIdx('metadata');

  const required = [iDrive, iDate, iLeistung, iGross, iBizGross, iStatus, iDup, iHint, biDrive, biName, biExt, biOcr, biMeta];
  if (required.some((value) => value < 0)) throw new Error('Required columns missing in Buchhaltung_DB or belege');

  const belegeByDrive = new Map<string, RowLike>();
  for (const row of belege.slice(1)) {
    const driveId = String(row[biDrive] || '').trim();
    if (!driveId) continue;
    belegeByDrive.set(driveId, row);
  }

  const groupCounts = new Map<string, number>();
  for (const row of db.slice(1)) {
    const group = String(row[iDup] || '').trim();
    if (!group) continue;
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  }

  let zeroBefore = 0;
  let zeroAfter = 0;
  let missingDateBefore = 0;
  let missingDateAfter = 0;
  let amountFixCount = 0;
  let dateFixCount = 0;
  let bothFixCount = 0;
  let duplicateCleanupCount = 0;

  const updates: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  const samples: FixSample[] = [];

  for (let i = 1; i < db.length; i++) {
    const row = db[i];
    const rowNumber = i + 1;
    const driveId = String(row[iDrive] || '').trim();
    if (!driveId) continue;

    const belegeRow = belegeByDrive.get(driveId) || [];
    const originalName = String(belegeRow[biName] || '');
    const text = `${String(belegeRow[biExt] || '')}\n${String(belegeRow[biOcr] || '')}`;
    const meta = parseMeta(belegeRow[biMeta]);

    const dateRaw = String(row[iDate] || '').trim();
    const leistungRaw = String(row[iLeistung] || '').trim();
    const rowYear = yearOfDateValue(dateRaw);
    const gross = toNum(row[iGross]);
    const bizGross = toNum(row[iBizGross]);

    const amount = amountCandidate(meta, originalName, text);
    const date = dateCandidate(meta, originalName, text);
    const dateYear = date.value ? yearOfDateValue(date.value) : 0;

    if (rowYear === TARGET_YEAR && gross === 0) zeroBefore += 1;
    if (!dateRaw && (rowYear === TARGET_YEAR || dateYear === TARGET_YEAR)) missingDateBefore += 1;

    let grossAfter = gross;
    let dateAfter = dateRaw;
    let changedAmount = false;
    let changedDate = false;

    const inAmountScope = rowYear === TARGET_YEAR || (!dateRaw && dateYear === TARGET_YEAR);
    if (gross === 0 && amount.value !== null && inAmountScope) {
      grossAfter = amount.value;
      changedAmount = true;
      amountFixCount += 1;
      updates.push({ range: `Buchhaltung_DB!${colLetter(iGross)}${rowNumber}`, values: [[grossAfter]] });
      if (bizGross === 0) {
        updates.push({ range: `Buchhaltung_DB!${colLetter(iBizGross)}${rowNumber}`, values: [[grossAfter]] });
      }
      if (samples.length < 60) {
        samples.push({
          row: rowNumber,
          driveFileId: driveId,
          action: 'amount',
          detail: `${amount.source} => ${grossAfter.toFixed(2)}`
        });
      }
    }

    if (!dateRaw && date.value && dateYear === TARGET_YEAR && grossAfter > 0) {
      dateAfter = date.value;
      changedDate = true;
      dateFixCount += 1;
      const serial = isoToSerial(date.value);
      updates.push({ range: `Buchhaltung_DB!${colLetter(iDate)}${rowNumber}`, values: [[serial]] });
      if (!leistungRaw) {
        updates.push({ range: `Buchhaltung_DB!${colLetter(iLeistung)}${rowNumber}`, values: [[serial]] });
      }
      if (samples.length < 60) {
        samples.push({
          row: rowNumber,
          driveFileId: driveId,
          action: 'date',
          detail: `${date.source} => ${date.value}`
        });
      }
    }

    if (changedAmount && changedDate) bothFixCount += 1;

    if (yearOfDateValue(dateAfter) === TARGET_YEAR && grossAfter === 0) zeroAfter += 1;
    if (!dateAfter && (rowYear === TARGET_YEAR || dateYear === TARGET_YEAR)) missingDateAfter += 1;

    const status = String(row[iStatus] || '').trim();
    const group = String(row[iDup] || '').trim();
    if (status === 'duplicate_candidate' && group && (groupCounts.get(group) || 0) < 2) {
      duplicateCleanupCount += 1;
      updates.push({ range: `Buchhaltung_DB!${colLetter(iStatus)}${rowNumber}`, values: [['ok']] });
      updates.push({ range: `Buchhaltung_DB!${colLetter(iDup)}${rowNumber}`, values: [['']] });
      const currentHint = String(row[iHint] || '').trim();
      const tag = '[auto] orphan_duplicate_cleared';
      const nextHint = currentHint.includes(tag) ? currentHint : `${currentHint}${currentHint ? ' ' : ''}${tag}`;
      updates.push({ range: `Buchhaltung_DB!${colLetter(iHint)}${rowNumber}`, values: [[nextHint]] });
      if (samples.length < 60) {
        samples.push({
          row: rowNumber,
          driveFileId: driveId,
          action: 'duplicate',
          detail: `orphan group cleared (${group})`
        });
      }
    }
  }

  if (APPLY && updates.length > 0) {
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
        }, { timeout: REQUEST_TIMEOUT_MS })
      );
    }
  }

  const lines: string[] = [];
  lines.push(`# MICRO Repair Quality ${TARGET_YEAR}`);
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Apply mode: ${APPLY}`);
  lines.push(`- Target year: ${TARGET_YEAR}`);
  lines.push(`- Planned cell updates: ${updates.length}`);
  lines.push(`- Amount fixes: ${amountFixCount}`);
  lines.push(`- Date fixes: ${dateFixCount}`);
  lines.push(`- Amount+Date same row: ${bothFixCount}`);
  lines.push(`- Orphan duplicate cleanup: ${duplicateCleanupCount}`);
  lines.push(`- Zero-amount in target year (before): ${zeroBefore}`);
  lines.push(`- Zero-amount in target year (after projection): ${zeroAfter}`);
  lines.push(`- Missing date in target-year scope (before): ${missingDateBefore}`);
  lines.push(`- Missing date in target-year scope (after projection): ${missingDateAfter}`);
  lines.push('');
  lines.push('| row | drive_file_id | action | detail |');
  lines.push('|---:|---|---|---|');
  for (const sample of samples) {
    lines.push(`| ${sample.row} | ${sample.driveFileId} | ${sample.action} | ${sample.detail.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    apply: APPLY,
    targetYear: TARGET_YEAR,
    plannedCellUpdates: updates.length,
    amountFixCount,
    dateFixCount,
    bothFixCount,
    duplicateCleanupCount,
    zeroBefore,
    zeroAfter,
    missingDateBefore,
    missingDateAfter,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_repair_quality_year', main).catch((error) => {
  console.error(error);
  process.exit(1);
});
