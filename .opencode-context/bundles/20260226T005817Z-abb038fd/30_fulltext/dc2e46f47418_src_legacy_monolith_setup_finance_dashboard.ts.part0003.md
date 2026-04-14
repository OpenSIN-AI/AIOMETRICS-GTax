# Context Fulltext

- source_path: src/legacy/monolith/setup_finance_dashboard.ts
- source_sha256: 8dd9f405d0952e3d2c00bd1c78b97a668ae75242d53d2d2ead4441c3f49ef18c
- chunk: 3/3

```text
dimension: 'COLUMNS', startIndex: 0, endIndex: 12 },
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
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Batch 1: Read years + ensure target sheets...');
  const years = await getYearList(sheets, spreadsheetId);
  const defaultYear = years.includes(2023) ? 2023 : years[years.length - 1];

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

```
