# Context Fulltext

- source_path: src/legacy/monolith/setup_finance_dashboard.ts
- source_sha256: 8dd9f405d0952e3d2c00bd1c78b97a668ae75242d53d2d2ead4441c3f49ef18c
- chunk: 2/3

```text
);0)))'],
    ['Strom/Energie', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Strom/Energie")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['Miete', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Miete")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['Versicherung', '=SUMPRODUCT((INDIRECT("Ausgaben_"&$B$2&"!I2:I")="Versicherung")*ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    ['Sonstige Ausgaben', '=B20-SUM(B12:B18)'],
    ['Summe Betriebsausgaben', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!H2:H");".";","));0)))'],
    [],
    ['EÜR Ergebnis (Gewinn/Verlust)', '=B9-B20'],
    ['Nicht abzugsfähige private Anteile', '=SUM(ArrayFormula(IFERROR(VALUE(SUBSTITUTE(INDIRECT("Ausgaben_"&$B$2&"!Y2:Y");".";","));0)))'],
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
    ['Ausgangssteuer 19%', '=\'' + DASHBOARD_SHEET + '\'!F8'],
    ['Ausgangssteuer 7%', '=\'' + DASHBOARD_SHEET + '\'!F9'],
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
        range: { sheetId: ids.euer, 
```
