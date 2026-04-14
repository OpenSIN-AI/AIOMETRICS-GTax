# Context Fulltext

- source_path: src/legacy/monolith/setup_finance_dashboard.ts
- source_sha256: 8dd9f405d0952e3d2c00bd1c78b97a668ae75242d53d2d2ead4441c3f49ef18c
- chunk: 1/3

```text
import * as dotenv from 'dotenv';
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

const REQUIRED_ENV = ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'] as const;

const DASHBOARD_SHEET = 'Finanz-Cockpit';
const DATA_SHEET = 'Dashboard_Daten';
const EUR_SHEET = 'EÜR';
const TAX_SHEET = 'Steuerreport';
const QA_SHEET = 'Plausibilitaet';
const AUDIT_SHEET = 'Audit_Tabellen';
const DB_SHEET = 'Buchhaltung_DB';

function mustEnv(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
  const max = 6;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === max) throw error;
      const wait = attempt * 2500;
      console.warn(`${op}: rate limited, retry ${attempt}/${max} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`${op}: exhausted`);
}

type SheetMap = Map<string, number>;

async function getSpreadsheet(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<any> {
  return await withRetry(
    () => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties(locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
    }),
    'spreadsheet.get'
  );
}

function toSheetMap(spreadsheet: sheets_v4.Schema$Spreadsheet): SheetMap {
  const map: SheetMap = new Map();
  for (const s of spreadsheet.sheets || []) {
    const title = s.properties?.title;
    const id = s.properties?.sheetId;
    if (title && typeof id === 'number') map.set(title, id);
  }
  return map;
}

async function ensureSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows = 2000,
  cols = 26
): Promise<number> {
  const ss = await getSpreadsheet(sheets, spreadsheetId);
  const existing = (ss.data.sheets || []).find((s: any) => s.properties?.title === title);
  if (existing?.properties?.sheetId !== undefined) {
    return existing.properties.sheetId;
  }
  const create = await withRetry(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title,
              gridProperties: {
                rowCount: rows,
                columnCount: cols
              }
            }
          }
        }]
      }
    }),
    `ensureSheet.add.${title}`
  );
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Could not create sheet ${title}`);
  return id;
}

async function clearSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<void> {
  await withRetry(
    () => sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${title}!A:ZZ`
    }),
    `clear.${title}`
  );
}

async function writeValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][]
): Promise<void> {
  await withRetry(
    () => sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    }),
    `values.update.${range}`
  );
}

async function getYearList(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<number[]> {
  const resp = await withRetry(
    () => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${DB_SHEET}!J2:J`
    }),
    'years.read'
  );
  const values = resp.data.values || [];
  const years = new Set<number>();
  const minYear = 2000;
  const maxYear = new Date().getFullYear() + 1;
  for (const row of values) {
    const value = String(row[0] || '').trim();
    const candidates = value.match(/\b20\d{2}\b/g) || [];
    for (const candidate of candidates) {
      const year = Number.parseInt(candidate, 10);
      if (year >= minYear && year <= maxYear) {
        years.add(year);
      }
    }
  }
  if (years.size === 0) {
    years.add(new Date().getFullYear());
  }

  const sheetMeta = await withRetry(
    () => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title'
    }),
    'years.sheetTitles'
  );
  for (const s of sheetMeta.data.sheets || []) {
    const title = s.properties?.title || '';
    const m = title.match(/^(?:Einnahmen|Ausgaben)_(20\d{2})$/);
    if (!m) continue;
    const year = Number.parseInt(m[1], 10);
    if (year >= minYear && year <= maxYear) {
      years.add(year);
    }
  }

  return Array.from(years).sort((a, b) => a - b);
}

function buildDashboardBlock(defaultYear: number): (string | number)[][] {
  const fRevenue = '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))';
  const fExpense = '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))';
  const fOutputVat = '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!G2:G");".";","));0)))';
  const fInputVat = '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!V2:V");".";","));0)))';
  const fPrivateShare = '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!Y2:Y");".";","));0)))';
  return [
    ['FINANZ-COCKPIT 2026 (Dynamisch)', '', '', '', '', '', '', '', '', '', '', ''],
    ['Jahr auswählen', defaultYear, '', 'Letzte Aktualisierung', '=NOW()', 'Alle Kennzahlen sind dynamisch je Jahr.', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Einnahmen brutto', '', 'Ausgaben brutto', '', 'EÜR Ergebnis', '', 'Ausgangssteuer', '', 'Vorsteuer', '', 'USt-Zahllast', ''],
    ['', fRevenue, '', fExpense, '', '=B5-D5', '', fOutputVat, '', fInputVat, '', '=H5-J5'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Plausibilitätschecks', '', '', '', 'Steuerreport', '', '', '', '', '', '', ''],
    ['Ausgabenquote (Ausgaben/Umsatz)', '=IF(B5=0;0;D5/B5)', '<= 1,20', '=IF(B8<=1,2;"OK";"WARNUNG")', 'USt 19% aus Einnahmen', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!S2:S");".";","));0)))', '', '', '', '', '', ''],
    ['Differenz Einnahmen KPI vs Monatsmatrix', '=B5-SUM(Dashboard_Daten!E2:E13)', '0,50 EUR', '=IF(ABS(B9)<=0,5;"OK";"ABWEICHUNG")', 'USt 7% aus Einnahmen', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!T2:T");".";","));0)))', '', '', '', '', '', ''],
    ['Differenz Ausgaben KPI vs Monatsmatrix', '=D5-SUM(Dashboard_Daten!F2:F13)', '0,50 EUR', '=IF(ABS(B10)<=0,5;"OK";"ABWEICHUNG")', 'Vorsteuer (geschäftlich)', '=J5', '', '', '', '', '', ''],
    ['Duplikat-Kandidaten im Jahr', '=COUNTIF(INDIRECT("Einnahmen_"&$B$2&"!J2:J");"duplicate_candidate")+COUNTIF(INDIRECT("Ausgaben_"&$B$2&"!J2:J");"duplicate_candidate")', '0', '=IF(B11=0;"OK";"PRÜFEN")', 'USt-Zahllast / Erstattung (-)', '=L5', '', '', '', '', '', ''],
    ['Belege ohne Betrag (im Jahr)', '=COUNTIF(INDIRECT("Einnahmen_"&$B$2&"!H2:H");0)+COUNTIF(INDIRECT("Ausgaben_"&$B$2&"!H2:H");0)', '0', '=IF(B12=0;"OK";"PRÜFEN")', 'Private Anteile Ausgaben', fPrivateShare, '', '', '', '', '', ''],
    ['Belege ohne Datum (global)', '=COUNTIFS(Buchhaltung_DB!E2:E;"<>";Buchhaltung_DB!J2:J;"")', '0', '=IF(B13=0;"OK";"PRÜFEN")', 'Vorläufig steuerlicher Gewinn', '=F5+F12', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Monat', 'Einnahmen', 'Ausgaben', 'Saldo', '', '', '', '', '', '', '', ''],
    ['=Dashboard_Daten!D2', '=Dashboard_Daten!E2', '=Dashboard_Daten!F2', '=Dashboard_Daten!G2', '', '', '', '', '', '', '', '']
  ];
}

function buildDataSheet(years: number[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  rows.push(['Jahr-Liste', 'Jahr ausgewählt', 'MonatNr', 'Monat', 'Einnahmen', 'Ausgaben', 'Saldo', '', 'Ausgaben nach Steuerkategorie', 'Betrag', '', 'USt-Metrik', 'Wert']);
  for (let i = 0; i < Math.max(years.length, 20); i++) {
    const yearValue = years[i] ?? '';
    const month = i < 12 ? i + 1 : '';
    const row = i + 2;
    rows.push([
      yearValue,
      i === 0 ? '=\'' + DASHBOARD_SHEET + '\'!$B$2' : '',
      month,
      month ? `=TEXT(DATE($B$2;C${row};1);"MMM")` : '',
      month ? `=SUMPRODUCT((IFERROR(VALUE(MID(INDIRECT("Einnahmen_"&$B$2&"!A2:A");6;2));0)=C${row})*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))` : '',
      month ? `=SUMPRODUCT((IFERROR(VALUE(MID(INDIRECT("Ausgaben_"&$B$2&"!A2:A");6;2));0)=C${row})*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))` : '',
      month ? `=E${row}-F${row}` : '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]);
  }

  const categories = [
    'Kraftstoff/Benzin',
    'Bewirtung',
    'IT/Hosting',
    'Strom/Energie',
    'Miete',
    'Versicherung',
    'Sonstiges'
  ];
  for (let i = 0; i < categories.length; i++) {
    const row = i + 2;
    const c = categories[i];
    rows[row - 1][8] = c;
    rows[row - 1][9] = `=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="${c}")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))`;
  }
  rows[8][8] = 'Gesamt';
  rows[8][9] = '=SUM(J2:J8)';
  rows[10][11] = 'Ausgangssteuer';
  rows[10][12] = '=\'' + DASHBOARD_SHEET + '\'!H5';
  rows[11][11] = 'Vorsteuer';
  rows[11][12] = '=\'' + DASHBOARD_SHEET + '\'!J5';
  rows[12][11] = 'Zahllast';
  rows[12][12] = '=\'' + DASHBOARD_SHEET + '\'!L5';
  rows[13][11] = 'EÜR Ergebnis';
  rows[13][12] = '=\'' + DASHBOARD_SHEET + '\'!F5';

  return rows;
}

function buildEuerBlock(): (string | number)[][] {
  return [
    ['EÜR (dynamisch, Jahr über Finanz-Cockpit)'],
    ['Jahr', '=\'' + DASHBOARD_SHEET + '\'!$B$2'],
    [],
    ['Betriebseinnahmen', 'Betrag (EUR)'],
    ['Umsätze 19% (brutto)', '=SUMPRODUCT((ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!S2:S");".";","));0))>0)*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))'],
    ['Umsätze 7% (brutto)', '=SUMPRODUCT((ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!T2:T");".";","));0))>0)*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))'],
    ['Umsätze 0% (brutto)', '=SUMPRODUCT((ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!U2:U");".";","));0))>0)*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))'],
    ['Sonstige Einnahmen', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))-SUM(B5:B7)'],
    ['Summe Betriebseinnahmen', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Einnahmen_"&$B$2&"!H2:H");".";","));0)))'],
    [],
    ['Betriebsausgaben', 'Betrag (EUR)'],
    ['Material/Waren (Sonstiges)', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Sonstiges")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['Kraftstoff/Benzin', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Kraftstoff/Benzin")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['Bewirtung', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Bewirtung")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['IT/Hosting', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="IT/Hosting")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";",")
```
