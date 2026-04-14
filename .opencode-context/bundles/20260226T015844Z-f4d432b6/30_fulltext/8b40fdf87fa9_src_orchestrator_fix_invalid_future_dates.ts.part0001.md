# Context Fulltext

- source_path: src/orchestrator/fix_invalid_future_dates.ts
- source_sha256: a127f9a75c05a861aa234e11c920ef3e76c0d44fb118ea4ef77e184603ed2c49
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function toIsoDate(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

function parseIsoYear(value: string): number {
  const m = (value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return Number.parseInt(m[1], 10);
}

function normalizeDate(value: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) {
    const y = Number.parseInt(iso[1], 10);
    const m = Number.parseInt(iso[2], 10);
    const d = Number.parseInt(iso[3], 10);
    if (isValidDate(y, m, d)) return toIsoDate(y, m, d);
  }
  const dmy = raw.match(/\b(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})\b/);
  if (dmy) {
    const d = Number.parseInt(dmy[1], 10);
    const m = Number.parseInt(dmy[2], 10);
    let y = Number.parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    if (isValidDate(y, m, d)) return toIsoDate(y, m, d);
  }
  return '';
}

function extractPlausibleDatesFromText(text: string, minYear: number, maxYear: number): string[] {
  const out = new Set<string>();
  const raw = text || '';

  const pushIfValid = (y: number, m: number, d: number): void => {
    if (!isValidDate(y, m, d)) return;
    if (y < minYear || y > maxYear) return;
    out.add(toIsoDate(y, m, d));
  };

  const dmyRe = /\b([0-3]?\d)[.\-/]([01]?\d)[.\-/](\d{2,4})\b/g;
  let m: RegExpExecArray | null = null;
  while ((m = dmyRe.exec(raw)) !== null) {
    const d = Number.parseInt(m[1], 10);
    const mm = Number.parseInt(m[2], 10);
    let y = Number.parseInt(m[3], 10);
    if (y < 100) y += 2000;
    pushIfValid(y, mm, d);
  }

  const ymdRe = /\b(20\d{2})[.\-/]([01]?\d)[.\-/]([0-3]?\d)\b/g;
  while ((m = ymdRe.exec(raw)) !== null) {
    const y = Number.parseInt(m[1], 10);
    const mm = Number.parseInt(m[2], 10);
    const d = Number.parseInt(m[3], 10);
    pushIfValid(y, mm, d);
  }

  return [...out].sort();
}

async function runWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 6;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const limited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!limited || i === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, i * 2000));
    }
  }
  throw new Error(`${label}: exhausted`);
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2020;
  const maxYear = currentYear + 1;

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [dbResp, belegeResp] = await Promise.all([
    runWithRetry(
      () => sheets.spreadsheets.values.get({ spreadsheetId, range: 'Buchhaltung_DB' }),
      'read.Buchhaltung_DB'
    ),
    runWithRetry(
      () => sheets.spreadsheets.values.get({ spreadsheetId, range: 'belege!A:Z' }),
      'read.belege'
    )
  ]);

  const dbValues = dbResp.data.values || [];
  const belegeValues = belegeResp.data.values || [];
  if (dbValues.length <= 1 || belegeValues.length <= 1) {
    console.log(JSON.stringify({ status: 'ok', updatedDbRows: 0, updatedBelegeRows: 0, touchedDriveIds: 0 }, null, 2));
    return;
  }

  const dbHeaders = dbValues[0];
  const bHeaders = belegeValues[0];
  const dbIdx = (name: string): number => dbHeaders.indexOf(name);
  const bIdx = (name: string): number => bHeaders.indexOf(name);

  const iDbDrive = dbIdx('drive_file_id');
  const iDbDate = dbIdx('belegdatum');
  const iDbLeistung = dbIdx('leistungsdatum');
  const iDbSupplier = dbIdx('lieferant');

  const iBDrive = bIdx('drive_file_id');
  const iBOcr = bIdx('ocr_text');
  const iBExt = bIdx('extracted_text');
  const iBMeta = bIdx('metadata');

  const belegeById = new Map<string, { rowNumber: number; ocr: string; ext: string; metadata: string }>();
  for (let r = 1; r < belegeValues.length; r++) {
    const row = belegeValues[r];
    const id = row[iBDrive] || '';
    if (!id) continue;
    if (belegeById.has(id)) continue;
    belegeById.set(id, {
      rowNumber: r + 1,
      ocr: row[iBOcr] || '',
      ext: row[iBExt] || '',
      metadata: row[iBMeta] || ''
    });
  }

  const dbUpdates: sheets_v4.Schema$ValueRange[] = [];
  const belegeUpdates: sheets_v4.Schema$ValueRange[] = [];
  const touched = new Set<string>();

  for (let r = 1; r < dbValues.length; r++) {
    const row = dbValues[r];
    const driveId = row[iDbDrive] || '';
    if (!driveId) continue;
    const oldDate = normalizeDate(row[iDbDate] || '');
    const oldYear = parseIsoYear(oldDate);
    const isOutlier = oldYear > maxYear || (oldYear > 0 && oldYear < minYear);
    if (!isOutlier) continue;

    const belege = belegeById.get(driveId);
    const textProbe = `${belege?.ocr || ''}\n${belege?.ext || ''}`;
    const candidates = extractPlausibleDatesFromText(textProbe, minYear, maxYear);
    if (candidates.length === 0) continue;

    // Use latest plausible date found in OCR/Text (for receipts, usually bottom line date).
    const newDate = candidates[candidates.length - 1];
    if (!newDate || newDate === oldDate) continue;

    dbUpdates.push({
      range: `Buchhaltung_DB!J${r + 1}:K${r + 1}`,
      values: [[newDate, newDate]]
    });
    touched.add(driveId);

    if (belege) {
      let metadataOut = belege.metadata || '';
      try {
        const m = JSON.parse(belege.metadata || '{}');
        m.invoice_date = newDate;
        m.extraction_note = m.extraction_note ? `${m.extraction_note};future_date_fixed` : 'future_date_fixed';
        metadataOut = JSON.stringify(m);
      } catch {
        metadataOut = JSON.stringify({ invoice_date: newDate, extraction_note: 'future_date_fixed' });
      }
      if (iBMeta >= 0) {
        const col = String.fromCharCode('A'.charCodeAt(0) + iBMeta);
        belegeUpdates.push({
          range: `belege!${col}${belege.rowNumber}`,
          values: [[metadataOut]]
        });
      }
    }
  }

  const writeBatches = async (updates: sheets_v4.Schema$ValueRange[], label: string): Promise<void> => {
    if (updates.length === 0) return;
    for (let i = 0; i < updates.length; i += 100) {
      const chunk = updates.slice(i, i + 100);
      await runWithRetry(
        () => sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: chunk
          }
        }),
        `${label}.chunk.${i / 100}`
      );
    }
  };

  await writeBatches(dbUpdates, 'write.db');
  await writeBatches(belegeUpdates, 'write.belege');

  console.log(JSON.stringify({
    status: 'ok',
    minYear,
    maxYear,
    updatedDbRows: dbUpdates.length,
    updatedBelegeRows: belegeUpdates.length,
    touchedDriveIds: touched.size
  }, null, 2));
}

main().catch((error) => {
  console.error('fix_invalid_future_dates failed:', error);
  process.exit(1);
});


```
