# Context Fulltext

- source_path: src/orchestrator/micro_plausibility_duplicate.ts
- source_sha256: 52d600b7d85842bbe8c40b848dab7a88c034f85552a456e08a234e19d32aaab7
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const YEAR = process.env.AUDIT_YEAR || '2023';
const MAX_OUTPUT_ROWS = Number.parseInt(process.env.MICRO_PLAUSI_MAX_ROWS || '400', 10);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_PLAUSIBILITY_DUPLICATE.md');
const PLAUSI_TAB = 'Plausibilitaet_Micro';

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

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

function yearFromDate(raw: string): string {
  const m1 = raw.match(/\b((?:19|20)\d{2})[-/.]\d{1,2}[-/.]\d{1,2}\b/);
  if (m1) return m1[1];
  const m2 = raw.match(/\b\d{1,2}[./-]\d{1,2}[./-]((?:19|20)\d{2})\b/);
  if (m2) return m2[1];
  return '';
}

async function ensureTabExists(title: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title'
  });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === title);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ'
  });
  const rows = (r.data.values || []) as string[][];
  if (rows.length <= 1) {
    console.log(JSON.stringify({ status: 'ok', findings: 0, reason: 'empty_db' }, null, 2));
    return;
  }
  const h = rows[0];
  const idx = (name: string) => h.indexOf(name);
  const iDrive = idx('drive_file_id');
  const iName = idx('dateiname_original');
  const iSupp = idx('lieferant');
  const iInv = idx('belegnr');
  const iDate = idx('belegdatum');
  const iGross = idx('brutto_gesamt');
  const iType = idx('belegart');
  const iTax = idx('steuerkategorie');
  const iStatus = idx('status');

  type Finding = {
    severity: 'high' | 'medium' | 'low';
    type: string;
    drive_file_id: string;
    dateiname: string;
    details: string;
  };
  const findings: Finding[] = [];
  const dupMap = new Map<string, string[]>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const driveId = String(row[iDrive] || '').trim();
    if (!driveId) continue;
    const date = String(row[iDate] || '');
    const year = yearFromDate(date);
    if (year && year !== YEAR) continue;
    const supplier = normalize(String(row[iSupp] || ''));
    const inv = normalize(String(row[iInv] || ''));
    const gross = parseNum(String(row[iGross] || '0'));
    const type = normalize(String(row[iType] || ''));
    const taxCat = normalize(String(row[iTax] || ''));
    const status = normalize(String(row[iStatus] || ''));
    const name = String(row[iName] || '');

    if (!supplier) findings.push({ severity: 'medium', type: 'missing_supplier', drive_file_id: driveId, dateiname: name, details: 'lieferant leer' });
    if (!date) findings.push({ severity: 'medium', type: 'missing_date', drive_file_id: driveId, dateiname: name, details: 'belegdatum leer' });
    if (!inv) findings.push({ severity: 'low', type: 'missing_invoice_no', drive_file_id: driveId, dateiname: name, details: 'belegnr leer' });
    if (gross <= 0) findings.push({ severity: 'medium', type: 'missing_gross', drive_file_id: driveId, dateiname: name, details: 'brutto_gesamt <= 0' });
    if (taxCat.includes('privat') && type === 'einnahme') findings.push({ severity: 'high', type: 'invalid_private_income', drive_file_id: driveId, dateiname: name, details: 'privat marker in einnahme' });
    if (status === 'pending') findings.push({ severity: 'low', type: 'pending_status', drive_file_id: driveId, dateiname: name, details: 'status pending' });

    const dupKey = `${inv}|${supplier}|${year || 'unknown'}|${gross.toFixed(2)}`;
    if (inv && supplier && gross > 0) {
      const arr = dupMap.get(dupKey) || [];
      arr.push(driveId);
      dupMap.set(dupKey, arr);
    }
  }

  for (const [key, ids] of dupMap.entries()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      findings.push({
        severity: 'high',
        type: 'duplicate_candidate',
        drive_file_id: id,
        dateiname: '',
        details: `dup_key=${key} count=${ids.length}`
      });
    }
  }

  findings.sort((a, b) => {
    const sev = { high: 3, medium: 2, low: 1 };
    return sev[b.severity] - sev[a.severity];
  });
  const limited = findings.slice(0, Math.max(1, MAX_OUTPUT_ROWS));

  await ensureTabExists(PLAUSI_TAB);
  const values: string[][] = [
    ['timestamp', new Date().toISOString()],
    ['year', YEAR],
    [],
    ['severity', 'type', 'drive_file_id', 'dateiname', 'details']
  ];
  for (const f of limited) values.push([f.severity, f.type, f.drive_file_id, f.dateiname, f.details]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PLAUSI_TAB}!A:Z`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PLAUSI_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  const countByType = new Map<string, number>();
  for (const f of findings) countByType.set(f.type, (countByType.get(f.type) || 0) + 1);

  const lines: string[] = [];
  lines.push('# MICRO Plausibility & Duplicate');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Year: ${YEAR}`);
  lines.push(`- Findings total: ${findings.length}`);
  lines.push(`- Written to sheet: ${limited.length}`);
  lines.push('');
  lines.push('| type | count |');
  lines.push('|---|---|');
  for (const [t, c] of countByType.entries()) lines.push(`| ${t} | ${c} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    year: YEAR,
    findings: findings.length,
    written: limited.length,
    sheetTab: PLAUSI_TAB,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_plausibility_duplicate', main).catch((e) => {
  console.error(e);
  process.exit(1);
});

```
