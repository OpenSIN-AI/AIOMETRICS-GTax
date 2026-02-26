import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const FORCE = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_FORMULA_FORCE || '0').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SHEET_FORMULA_GUARD.md');

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

type FormulaSpec = { cell: string; formula: string };

async function readCell(tab: string, cell: string): Promise<string> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${cell}:${cell}`
  });
  return String(r.data.values?.[0]?.[0] || '');
}

async function applyFormulas(tab: string, specs: FormulaSpec[]): Promise<number> {
  const updates: Array<{ range: string; values: string[][] }> = [];
  for (const s of specs) {
    const current = await readCell(tab, s.cell);
    const shouldWrite = FORCE || !current || !String(current).startsWith('=');
    if (shouldWrite) updates.push({ range: `${tab}!${s.cell}`, values: [[s.formula]] });
  }
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });
  }
  return updates.length;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const eurSpecs: FormulaSpec[] = [
    { cell: 'B2', formula: `=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))` },
    { cell: 'B5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!M2:M>0));0)` },
    { cell: 'B6', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!N2:N>0));0)` },
    { cell: 'B7', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!O2:O>0));0)` },
    { cell: 'B8', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B5:B7);0)` },
    { cell: 'B9', formula: `=SUM(B5:B8)` },
    { cell: 'B12', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)material|pv")));0)` },
    { cell: 'B13', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)kraftstoff|benzin|diesel")));0)` },
    { cell: 'B14', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)telekommunikation|it|hosting|domain")));0)` },
    { cell: 'B15', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)versicherung")));0)` },
    { cell: 'B16', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B12:B15);0)` },
    { cell: 'B17', formula: `=SUM(B12:B16)` },
    { cell: 'B18', formula: `=B9-B17` },
    { cell: 'B19', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))+SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2));0)` }
  ];

  const cockpitSpecs: FormulaSpec[] = [
    { cell: 'B2', formula: `=YEAR(TODAY())` },
    { cell: 'B5', formula: `=IFERROR(EÜR!B9;0)` },   // Einnahmen brutto
    { cell: 'E5', formula: `=IFERROR(EÜR!B17;0)` },  // Ausgaben brutto
    { cell: 'H5', formula: `=IFERROR(EÜR!B18;0)` },  // EÜR Ergebnis
    { cell: 'K5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)` },
    { cell: 'N5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)` },
    { cell: 'Q5', formula: `=K5-N5` }
  ];

  const [eurApplied, cockpitApplied] = await Promise.all([
    applyFormulas('EÜR', eurSpecs),
    applyFormulas('Finanz-Cockpit', cockpitSpecs)
  ]);

  const lines: string[] = [];
  lines.push('# MICRO Sheet Formula Guard');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Force mode: ${FORCE}`);
  lines.push(`- EÜR formulas written: ${eurApplied}`);
  lines.push(`- Finanz-Cockpit formulas written: ${cockpitApplied}`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    force: FORCE,
    eurApplied,
    cockpitApplied,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_sheet_formula_guard', main).catch((e) => {
  console.error(e);
  process.exit(1);
});
