import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';
import { parsePositiveInt, withGoogleApiRetry } from './shared/google_api_retry.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const FORCE = ['1', 'true', 'yes', 'on'].includes(String(process.env.MICRO_FORMULA_FORCE || '0').toLowerCase());
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SHEET_FORMULA_GUARD.md');
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.MICRO_FORMULA_REQUEST_TIMEOUT_MS, 30000);
const API_MAX_RETRIES = parsePositiveInt(process.env.MICRO_FORMULA_API_MAX_RETRIES, 4);
const API_RETRY_BASE_MS = parsePositiveInt(process.env.MICRO_FORMULA_API_RETRY_BASE_MS, 1500);
const API_RETRY_MAX_MS = parsePositiveInt(process.env.MICRO_FORMULA_API_RETRY_MAX_MS, 15000);

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

type FormulaSpec = { cell: string; formula: string };

async function withApiRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withGoogleApiRetry(operation, fn, {
    maxAttempts: API_MAX_RETRIES,
    baseDelayMs: API_RETRY_BASE_MS,
    maxDelayMs: API_RETRY_MAX_MS,
    loggerPrefix: 'micro_sheet_formula_guard'
  });
}

async function readFormulaMap(tab: string, specs: FormulaSpec[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (specs.length === 0) return map;
  const ranges = specs.map((s) => `${tab}!${s.cell}:${s.cell}`);
  const r = await withApiRetry(
    `sheets.values.batchGet.${tab}`,
    () => sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
      valueRenderOption: 'FORMULA'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  for (const valueRange of r.data.valueRanges || []) {
    const fullRange = String(valueRange.range || '');
    const cellRef = fullRange.split('!')[1]?.split(':')[0]?.replace(/\$/g, '') || '';
    if (!cellRef) continue;
    map.set(cellRef, String(valueRange.values?.[0]?.[0] || ''));
  }
  return map;
}

function normalizeFormula(formula: string): string {
  return String(formula || '')
    .replace(/\s+/g, '')
    .replace(/'([^']+)'!/g, '$1!')
    .trim();
}

async function applyFormulas(tab: string, specs: FormulaSpec[]): Promise<number> {
  const updates: Array<{ range: string; values: string[][] }> = [];
  const existing = await readFormulaMap(tab, specs);
  for (const s of specs) {
    const current = existing.get(s.cell) || '';
    const shouldWrite = FORCE
      || !current
      || !String(current).startsWith('=')
      || normalizeFormula(current) !== normalizeFormula(s.formula);
    if (shouldWrite) updates.push({ range: `${tab}!${s.cell}`, values: [[s.formula]] });
  }
  if (updates.length > 0) {
    await withApiRetry(
      `sheets.values.batchUpdate.${tab}`,
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
  return updates.length;
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const yearExpr = 'IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));IFERROR(YEAR(Buchhaltung_DB!J2:J);IFERROR(VALUE(REGEXEXTRACT(Buchhaltung_DB!D2:D;"(20\\\\d{2})"));IFERROR(VALUE(REGEXEXTRACT(Buchhaltung_DB!C2:C;"(20\\\\d{2})"));0))))';
  const flowUnclearExpr = 'N(Buchhaltung_DB!E2:E<>"Einnahme")*N(Buchhaltung_DB!E2:E<>"Ausgabe")';
  const flowNonTransactionExpr = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C&" "&Buchhaltung_DB!L2:L);"einnahmen.{0,12}berschussrechnung|umsatzsteuer.{0,18}voranmeldung|steuerbescheid|jahresabschluss|gewinn.{0,8}verlust|kontenblatt|\\\\bbwa\\\\b|\\\\belster\\\\b"))';
  const flowIncomeHintExpr = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"einnahmen|photovoltaik|\\\\bpv\\\\b"))+N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C);"\\\\beinnahme\\\\b|\\\\bgutschrift\\\\b|\\\\bumsatz\\\\b"))';
  const flowExpenseHintExpr = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"ausgaben|material|waren|kraftstoff|benzin|bewirt|telekommunikation|it|hosting|strom|energie|miete|versicherung|sonstige"))+N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C);"\\\\bausgabe\\\\b|\\\\brechnung\\\\b|\\\\binvoice\\\\b|\\\\bquittung\\\\b|\\\\bbestellung\\\\b"))';
  const flowIncomeExpr = '(N(Buchhaltung_DB!E2:E="Einnahme")+N(' + flowUnclearExpr + '>0)*N(' + flowNonTransactionExpr + '=0)*N(' + flowIncomeHintExpr + '>0)*N(' + flowExpenseHintExpr + '=0))>0';
  const flowExpenseExpr = '(N(Buchhaltung_DB!E2:E="Ausgabe")+N(' + flowUnclearExpr + '>0)*N(' + flowNonTransactionExpr + '=0)*N(' + flowExpenseHintExpr + '>0)*N(' + flowIncomeHintExpr + '=0))>0';
  const yearMatchExpr = '((N($B$2)=0)+N(' + yearExpr + '=$B$2))>0';

  const eurSpecs: FormulaSpec[] = [
    { cell: 'B2', formula: `=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))` },
    { cell: 'B5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowIncomeExpr}; ${yearMatchExpr}; Buchhaltung_DB!M2:M>0));0)` },
    { cell: 'B6', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowIncomeExpr}; ${yearMatchExpr}; Buchhaltung_DB!N2:N>0));0)` },
    { cell: 'B7', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowIncomeExpr}; ${yearMatchExpr}; Buchhaltung_DB!O2:O>0));0)` },
    { cell: 'B8', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowIncomeExpr}; ${yearMatchExpr}))-SUM(B5:B7);0)` },
    { cell: 'B9', formula: `=SUM(B5:B8)` },
    { cell: 'B12', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"material|waren|pv|photovoltaik")));0)` },
    { cell: 'B13', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"kraftstoff|benzin|diesel|tank")));0)` },
    { cell: 'B14', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"bewirt|restaurant|cafe|imbiss|wolt|lieferando")));0)` },
    { cell: 'B15', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"telekommunikation|it|hosting|domain|software|cloud")));0)` },
    { cell: 'B16', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"strom|energie")));0)` },
    { cell: 'B17', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"miete|pacht")));0)` },
    { cell: 'B18', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${flowExpenseExpr}; ${yearMatchExpr}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"versicherung")));0)` },
    { cell: 'B19', formula: `=MAX(0;B20-SUM(B12:B18))` },
    { cell: 'B20', formula: `=SUMPRODUCT(N(${flowExpenseExpr})*N(${yearMatchExpr})*N(Buchhaltung_DB!Q2:Q))` },
    { cell: 'B22', formula: `=B9-B20` },
    { cell: 'B23', formula: `=SUMPRODUCT(N(${flowExpenseExpr})*N(${yearMatchExpr})*N(Buchhaltung_DB!U2:U))` },
    { cell: 'B24', formula: `=B22+B23` }
  ];

  const cockpitSpecs: FormulaSpec[] = [
    { cell: 'B5', formula: `=IFERROR(EÜR!B9;0)` },   // Einnahmen brutto
    { cell: 'D5', formula: `=IFERROR(EÜR!B20;0)` },  // Ausgaben brutto
    { cell: 'F5', formula: `=B5-D5` },               // EÜR Ergebnis
    { cell: 'H5', formula: `=IFERROR(Steuerreport!B10;0)` }, // Ausgangssteuer
    { cell: 'J5', formula: `=IFERROR(Steuerreport!B11;0)` }, // Vorsteuer
    { cell: 'L5', formula: `=H5-J5` }
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
