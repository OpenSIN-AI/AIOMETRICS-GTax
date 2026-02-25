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
  return Array.from(years).sort((a, b) => a - b);
}

function buildDashboardBlock(defaultYear: number): (string | number)[][] {
  const fRevenue = '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))';
  const fExpense = '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))';
  const fOutputVat = '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!M2:M))+SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!N2:N))';
  const fInputVat = '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!R2:R))';
  const fPrivateShare = '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!U2:U))';
  return [
    ['FINANZ-COCKPIT 2026 (Dynamisch)', '', '', '', '', '', '', '', '', '', '', ''],
    ['Jahr auswählen', defaultYear, '', 'Letzte Aktualisierung', '=NOW()', 'Alle Kennzahlen sind dynamisch je Jahr.', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Einnahmen brutto', '', 'Ausgaben brutto', '', 'EÜR Ergebnis', '', 'Ausgangssteuer', '', 'Vorsteuer', '', 'USt-Zahllast', ''],
    ['', fRevenue, '', fExpense, '', '=B5-D5', '', fOutputVat, '', fInputVat, '', '=H5-J5'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Plausibilitätschecks', '', '', '', 'Steuerreport', '', '', '', '', '', '', ''],
    ['Ausgabenquote (Ausgaben/Umsatz)', '=IF(B5=0;0;D5/B5)', '<= 1,20', '=IF(B8<=1,2;"OK";"WARNUNG")', 'USt 19% aus Einnahmen', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!M2:M))', '', '', '', '', '', ''],
    ['Differenz Einnahmen KPI vs Monatsmatrix', '=B5-SUM(Dashboard_Daten!E2:E13)', '0,50 EUR', '=IF(ABS(B9)<=0,5;"OK";"ABWEICHUNG")', 'USt 7% aus Einnahmen', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!N2:N))', '', '', '', '', '', ''],
    ['Differenz Ausgaben KPI vs Monatsmatrix', '=D5-SUM(Dashboard_Daten!F2:F13)', '0,50 EUR', '=IF(ABS(B10)<=0,5;"OK";"ABWEICHUNG")', 'Vorsteuer (geschäftlich)', '=J5', '', '', '', '', '', ''],
    ['Duplikat-Kandidaten im Jahr', '=SUMPRODUCT((LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(Buchhaltung_DB!AC2:AC="duplicate_candidate"))', '0', '=IF(B11=0;"OK";"PRÜFEN")', 'USt-Zahllast / Erstattung (-)', '=L5', '', '', '', '', '', ''],
    ['Belege ohne Betrag (im Jahr)', '=SUMPRODUCT((LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(N(Buchhaltung_DB!Q2:Q)=0))', '0', '=IF(B12=0;"OK";"PRÜFEN")', 'Private Anteile Ausgaben', fPrivateShare, '', '', '', '', '', ''],
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
      month ? `=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(VALUE(MID(Buchhaltung_DB!J2:J;6;2))=C${row})*N(Buchhaltung_DB!Q2:Q))` : '',
      month ? `=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(VALUE(MID(Buchhaltung_DB!J2:J;6;2))=C${row})*N(Buchhaltung_DB!Q2:Q))` : '',
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
    rows[row - 1][9] = `=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="${c}")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))`;
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
    ['Umsätze 19% (brutto)', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(N(Buchhaltung_DB!M2:M)>0)*N(Buchhaltung_DB!Q2:Q))'],
    ['Umsätze 7% (brutto)', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*(N(Buchhaltung_DB!N2:N)>0)*N(Buchhaltung_DB!Q2:Q))'],
    ['Umsätze 0% (brutto)', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*((N(Buchhaltung_DB!M2:M)+N(Buchhaltung_DB!N2:N))=0)*N(Buchhaltung_DB!Q2:Q))'],
    ['Sonstige Einnahmen', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))-SUM(B5:B7)'],
    ['Summe Betriebseinnahmen', '=SUM(B5:B8)'],
    [],
    ['Betriebsausgaben', 'Betrag (EUR)'],
    ['Material/Waren (Sonstiges)', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Sonstiges")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Kraftstoff/Benzin', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Kraftstoff/Benzin")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Bewirtung', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Bewirtung")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['IT/Hosting', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="IT/Hosting")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Strom/Energie', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Strom/Energie")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Miete', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Miete")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Versicherung', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(Buchhaltung_DB!L2:L="Versicherung")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    ['Sonstige Ausgaben', '=B20-SUM(B12:B18)'],
    ['Summe Betriebsausgaben', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!Q2:Q))'],
    [],
    ['EÜR Ergebnis (Gewinn/Verlust)', '=B9-B20'],
    ['Nicht abzugsfähige private Anteile', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Ausgabe")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!U2:U))'],
    ['Vorläufig steuerlicher Gewinn', '=B22+B23'],
    ['Hinweis', 'Vorläufige technische Vorschau. Für Abgabe bitte Steuerberatung/ELSTER final prüfen.'],
    [],
    ['Detailansicht Belege (dynamisch)'],
    ['Datum', 'Belegart', 'Lieferant', 'Belegnr', 'Steuerkategorie', 'Brutto', 'geschäftl. MwSt', 'privater Anteil', 'Sollkonto', 'Habenkonto', 'Hinweis', 'Datei-URL'],
    ['=IFERROR(SORT(FILTER({Buchhaltung_DB!J2:J\\Buchhaltung_DB!E2:E\\Buchhaltung_DB!F2:F\\Buchhaltung_DB!H2:H\\Buchhaltung_DB!L2:L\\Buchhaltung_DB!Q2:Q\\Buchhaltung_DB!R2:R\\Buchhaltung_DB!U2:U\\Buchhaltung_DB!V2:V\\Buchhaltung_DB!W2:W\\Buchhaltung_DB!AA2:AA\\Buchhaltung_DB!B2:B};LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"));1;TRUE);"Keine Datensätze im gewählten Jahr")']
  ];
}

function buildTaxBlock(): (string | number)[][] {
  return [
    ['Steuerreport (USt + ESt Vorschau)'],
    ['Jahr', '=\'' + DASHBOARD_SHEET + '\'!$B$2'],
    [],
    ['Umsatzsteuer-Erklärung (vereinfachte Vorschau)', 'Wert'],
    ['Umsätze 19% (brutto)', '=\'' + EUR_SHEET + '\'!B5'],
    ['Umsätze 7% (brutto)', '=\'' + EUR_SHEET + '\'!B6'],
    ['Umsätze 0% (brutto)', '=\'' + EUR_SHEET + '\'!B7'],
    ['Ausgangssteuer 19%', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!M2:M))'],
    ['Ausgangssteuer 7%', '=SUMPRODUCT((Buchhaltung_DB!E2:E="Einnahme")*(LEFT(Buchhaltung_DB!J2:J;4)=TEXT($B$2;"0"))*N(Buchhaltung_DB!N2:N))'],
    ['Ausgangssteuer gesamt', '=B8+B9'],
    ['Vorsteuer abzugsfähig', '=\'' + DASHBOARD_SHEET + '\'!J5'],
    ['USt-Zahllast / Erstattung (-)', '=B10-B11'],
    [],
    ['Einkommensteuer-Basis (vereinfacht)', 'Wert'],
    ['Betriebseinnahmen', '=\'' + EUR_SHEET + '\'!B9'],
    ['Betriebsausgaben', '=\'' + EUR_SHEET + '\'!B20'],
    ['Gewinn/Verlust', '=\'' + EUR_SHEET + '\'!B22'],
    ['Private Anteile (+)', '=\'' + EUR_SHEET + '\'!B23'],
    ['Vorläufig steuerlicher Gewinn', '=\'' + EUR_SHEET + '\'!B24'],
    ['Hinweis', 'Diese Werte sind technische Vorprüfung und ersetzen keine steuerliche Beratung.']
  ];
}

function buildQaBlock(): (string | number)[][] {
  return [
    ['Plausibilitätsprüfung'],
    ['Jahr', '=\'' + DASHBOARD_SHEET + '\'!$B$2'],
    [],
    ['Prüfung', 'Wert', 'Toleranz', 'Status', 'Hinweis'],
    ['Einnahmen KPI vs Monatsmatrix', '=ABS(\'' + DASHBOARD_SHEET + '\'!B9)', 0.5, '=IF(B5<=C5;"OK";"ABWEICHUNG")', 'Soll 0 sein'],
    ['Ausgaben KPI vs Monatsmatrix', '=ABS(\'' + DASHBOARD_SHEET + '\'!B10)', 0.5, '=IF(B6<=C6;"OK";"ABWEICHUNG")', 'Soll 0 sein'],
    ['USt-Zahllast Konsistenz', '=ABS(\'' + DASHBOARD_SHEET + '\'!L5-\'' + TAX_SHEET + '\'!B12)', 0.5, '=IF(B7<=C7;"OK";"ABWEICHUNG")', 'Dashboard vs Steuerreport'],
    ['Belege ohne Betrag im Jahr', '=\'' + DASHBOARD_SHEET + '\'!B12', 0, '=IF(B8=0;"OK";"PRÜFEN")', 'Betrag fehlt'],
    ['Belege ohne Datum (global)', '=\'' + DASHBOARD_SHEET + '\'!B13', 0, '=IF(B9=0;"OK";"PRÜFEN")', 'Datum fehlt'],
    ['Duplikat-Kandidaten im Jahr', '=\'' + DASHBOARD_SHEET + '\'!B11', 0, '=IF(B10=0;"OK";"PRÜFEN")', 'Nur Originale sollten bleiben'],
    ['Ausgabenquote', '=\'' + DASHBOARD_SHEET + '\'!B8', 1.2, '=IF(B11<=C11;"OK";"WARNUNG")', 'Ausgaben/Umsatz'],
    ['Private Anteile', '=\'' + DASHBOARD_SHEET + '\'!F12', 0, '=IF(B12=0;"OK";"INFO")', 'Bei Mischbelegen normal']
  ];
}

async function createAuditSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  spreadsheet: sheets_v4.Schema$Spreadsheet
): Promise<void> {
  const rows: string[][] = [[
    'sheet_title',
    'sheet_id',
    'rows',
    'cols',
    'header_preview',
    'bewertung'
  ]];

  for (const s of spreadsheet.sheets || []) {
    const title = s.properties?.title || '';
    const id = String(s.properties?.sheetId ?? '');
    const rowsCount = String(s.properties?.gridProperties?.rowCount ?? '');
    const colsCount = String(s.properties?.gridProperties?.columnCount ?? '');
    let headerPreview = '';
    try {
      const resp = await withRetry(
        () => sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${title}!1:1`
        }),
        `audit.header.${title}`
      );
      headerPreview = (resp.data.values?.[0] || []).slice(0, 8).join(' | ');
    } catch {
      headerPreview = '';
    }

    let rating = 'OK';
    if (title.startsWith('Einnahmen_') || title.startsWith('Ausgaben_')) rating = 'Legacy-Tab (alte Struktur)';
    if (title === 'Finanz-Cockpit' && !headerPreview) rating = 'Leeres Dashboardblatt';
    if (title === DB_SHEET) rating = 'Haupt-DB (soll erhalten bleiben)';
    rows.push([title, id, rowsCount, colsCount, headerPreview, rating]);
  }

  await clearSheet(sheets, spreadsheetId, AUDIT_SHEET);
  await writeValues(sheets, spreadsheetId, `${AUDIT_SHEET}!A1`, rows);
}

async function applyFormatting(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  ids: { dashboard: number; data: number; euer: number; tax: number; qa: number; audit: number }
): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = [
    {
      updateSheetProperties: {
        properties: { sheetId: ids.dashboard, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.data, hidden: true, gridProperties: { frozenRowCount: 1 } },
        fields: 'hidden,gridProperties.frozenRowCount'
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.euer, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.tax, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.qa, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.audit, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.dashboard,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.09, green: 0.24, blue: 0.47 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 14 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.dashboard,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 0,
          endColumnIndex: 12
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.89, green: 0.93, blue: 0.98 },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.dashboard,
          startRowIndex: 4,
          endRowIndex: 5,
          startColumnIndex: 0,
          endColumnIndex: 12
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '#,##0.00 [$€-de-DE]' },
            textFormat: { bold: true, fontSize: 12 }
          }
        },
        fields: 'userEnteredFormat(numberFormat,textFormat)'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.dashboard,
          startRowIndex: 14,
          endRowIndex: 15,
          startColumnIndex: 0,
          endColumnIndex: 4
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.83, green: 0.89, blue: 0.95 },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      setDataValidation: {
        range: {
          sheetId: ids.dashboard,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 1,
          endColumnIndex: 2
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: '=Dashboard_Daten!$A$2:$A$200' }]
          },
          strict: true,
          showCustomUi: true
        }
      }
    },
    {
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{
            sheetId: ids.dashboard,
            startRowIndex: 7,
            endRowIndex: 13,
            startColumnIndex: 3,
            endColumnIndex: 4
          }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] },
            format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } }
          }
        }
      }
    },
    {
      addConditionalFormatRule: {
        index: 1,
        rule: {
          ranges: [{
            sheetId: ids.dashboard,
            startRowIndex: 7,
            endRowIndex: 13,
            startColumnIndex: 3,
            endColumnIndex: 4
          }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'WARNUNG' }] },
            format: { backgroundColor: { red: 1, green: 0.95, blue: 0.8 } }
          }
        }
      }
    },
    {
      addConditionalFormatRule: {
        index: 2,
        rule: {
          ranges: [{
            sheetId: ids.dashboard,
            startRowIndex: 7,
            endRowIndex: 13,
            startColumnIndex: 3,
            endColumnIndex: 4
          }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'ABWEICHUNG' }] },
            format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } }
          }
        }
      }
    },
    {
      addConditionalFormatRule: {
        index: 3,
        rule: {
          ranges: [{
            sheetId: ids.qa,
            startRowIndex: 4,
            endRowIndex: 12,
            startColumnIndex: 3,
            endColumnIndex: 4
          }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] },
            format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } }
          }
        }
      }
    },
    {
      addConditionalFormatRule: {
        index: 4,
        rule: {
          ranges: [{
            sheetId: ids.qa,
            startRowIndex: 4,
            endRowIndex: 12,
            startColumnIndex: 3,
            endColumnIndex: 4
          }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'ABWEICHUNG' }] },
            format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } }
          }
        }
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: ids.dashboard, dimension: 'COLUMNS', startIndex: 0, endIndex: 12 },
        properties: { pixelSize: 170 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: ids.euer, dimension: 'COLUMNS', startIndex: 0, endIndex: 12 },
        properties: { pixelSize: 160 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: ids.tax, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 },
        properties: { pixelSize: 210 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: ids.qa, dimension: 'COLUMNS', startIndex: 0, endIndex: 5 },
        properties: { pixelSize: 220 },
        fields: 'pixelSize'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.euer,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.09, green: 0.24, blue: 0.47 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.tax,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.09, green: 0.24, blue: 0.47 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ids.qa,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 5
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.09, green: 0.24, blue: 0.47 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    }
  ];

  await withRetry(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    }),
    'format.batchUpdate'
  );
}

async function addCharts(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  ids: { dashboard: number; data: number }
): Promise<void> {
  const current = await withRetry(
    () => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId),charts(chartId))'
    }),
    'charts.read'
  );
  const existingDashboardChartIds = (current.data.sheets || [])
    .filter((s) => s.properties?.sheetId === ids.dashboard)
    .flatMap((s) => (s.charts || []).map((c) => c.chartId).filter((id): id is number => typeof id === 'number'));

  if (existingDashboardChartIds.length > 0) {
    await withRetry(
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: existingDashboardChartIds.map((chartId) => ({
            deleteEmbeddedObject: { objectId: chartId }
          }))
        }
      }),
      'charts.deleteExisting'
    );
  }

  const requests: sheets_v4.Schema$Request[] = [
    {
      addChart: {
        chart: {
          spec: {
            title: 'Monatlicher Verlauf: Einnahmen vs Ausgaben',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'BOTTOM_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Monat' },
                { position: 'LEFT_AXIS', title: 'EUR' }
              ],
              domains: [{
                domain: {
                  sourceRange: {
                    sources: [{
                      sheetId: ids.data,
                      startRowIndex: 1,
                      endRowIndex: 13,
                      startColumnIndex: 3,
                      endColumnIndex: 4
                    }]
                  }
                }
              }],
              series: [
                {
                  series: {
                    sourceRange: {
                      sources: [{
                        sheetId: ids.data,
                        startRowIndex: 1,
                        endRowIndex: 13,
                        startColumnIndex: 4,
                        endColumnIndex: 5
                      }]
                    }
                  },
                  targetAxis: 'LEFT_AXIS'
                },
                {
                  series: {
                    sourceRange: {
                      sources: [{
                        sheetId: ids.data,
                        startRowIndex: 1,
                        endRowIndex: 13,
                        startColumnIndex: 5,
                        endColumnIndex: 6
                      }]
                    }
                  },
                  targetAxis: 'LEFT_AXIS'
                }
              ]
            }
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: ids.dashboard,
                rowIndex: 14,
                columnIndex: 5
              },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 760,
              heightPixels: 360
            }
          }
        }
      }
    },
    {
      addChart: {
        chart: {
          spec: {
            title: 'Ausgaben nach Steuerkategorie',
            pieChart: {
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId: ids.data,
                    startRowIndex: 1,
                    endRowIndex: 8,
                    startColumnIndex: 8,
                    endColumnIndex: 9
                  }]
                }
              },
              series: {
                sourceRange: {
                  sources: [{
                    sheetId: ids.data,
                    startRowIndex: 1,
                    endRowIndex: 8,
                    startColumnIndex: 9,
                    endColumnIndex: 10
                  }]
                }
              }
            }
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: ids.dashboard,
                rowIndex: 33,
                columnIndex: 5
              },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 760,
              heightPixels: 320
            }
          }
        }
      }
    }
  ];

  await withRetry(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    }),
    'charts.batchUpdate'
  );
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Batch 1: Read years + ensure target sheets...');
  const years = await getYearList(sheets, spreadsheetId);
  const defaultYear = years[years.length - 1];

  const dashboardId = await ensureSheet(sheets, spreadsheetId, DASHBOARD_SHEET, 1200, 30);
  const dataId = await ensureSheet(sheets, spreadsheetId, DATA_SHEET, 1200, 30);
  const euerId = await ensureSheet(sheets, spreadsheetId, EUR_SHEET, 2000, 20);
  const taxId = await ensureSheet(sheets, spreadsheetId, TAX_SHEET, 1200, 12);
  const qaId = await ensureSheet(sheets, spreadsheetId, QA_SHEET, 1200, 12);
  const auditId = await ensureSheet(sheets, spreadsheetId, AUDIT_SHEET, 2000, 10);

  console.log('Batch 2: Write dashboard/euer/tax/qa data...');
  await clearSheet(sheets, spreadsheetId, DASHBOARD_SHEET);
  await clearSheet(sheets, spreadsheetId, DATA_SHEET);
  await clearSheet(sheets, spreadsheetId, EUR_SHEET);
  await clearSheet(sheets, spreadsheetId, TAX_SHEET);
  await clearSheet(sheets, spreadsheetId, QA_SHEET);

  await writeValues(sheets, spreadsheetId, `${DASHBOARD_SHEET}!A1`, buildDashboardBlock(defaultYear));
  await writeValues(sheets, spreadsheetId, `${DATA_SHEET}!A1`, buildDataSheet(years));
  await writeValues(sheets, spreadsheetId, `${EUR_SHEET}!A1`, buildEuerBlock());
  await writeValues(sheets, spreadsheetId, `${TAX_SHEET}!A1`, buildTaxBlock());
  await writeValues(sheets, spreadsheetId, `${QA_SHEET}!A1`, buildQaBlock());

  console.log('Batch 3: Audit all tabs + formatting...');
  const ss = await getSpreadsheet(sheets, spreadsheetId);
  await createAuditSheet(sheets, spreadsheetId, ss.data);
  await applyFormatting(sheets, spreadsheetId, {
    dashboard: dashboardId,
    data: dataId,
    euer: euerId,
    tax: taxId,
    qa: qaId,
    audit: auditId
  });

  console.log('Batch 4: Add charts...');
  await addCharts(sheets, spreadsheetId, {
    dashboard: dashboardId,
    data: dataId
  });

  console.log(JSON.stringify({
    status: 'ok',
    defaultYear,
    years,
    sheets: {
      dashboardId,
      dataId,
      euerId,
      taxId,
      qaId,
      auditId
    }
  }, null, 2));
}

withPipelineLock('setup_finance_dashboard', main).catch((error) => {
  console.error('setup_finance_dashboard failed:', error);
  process.exit(1);
});
