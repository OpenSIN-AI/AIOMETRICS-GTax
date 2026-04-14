# Context Fulltext

- source_path: src/orchestrator/check_2023_integrity.ts
- source_sha256: 5e421091d844beaafe5392f77477bf5798717a77ac8d09e801607e67a61b60e7
- chunk: 2/2

```text
t.duplicateDriveIdsInSheet.slice(0, 50)) {
      lines.push(`- ${item.driveFileId} | rows=${item.rows.join(',')}`);
    }
    lines.push('');
  }

  if (result.potentialPrivateRows.length > 0) {
    lines.push('### Verdacht Privatbeleg im Sheet (Top 50)');
    lines.push('');
    for (const row of result.potentialPrivateRows.slice(0, 50)) {
      lines.push(`- Row ${row.rowNumber} | ${row.driveFileId} | ${row.lieferant} | ${row.kategorie} | ${row.dateiname}`);
    }
    lines.push('');
  }

  if (result.potentialDuplicateBusinessKeys.length > 0) {
    lines.push('### Verdacht Duplikat Business-Key (Top 50)');
    lines.push('');
    for (const item of result.potentialDuplicateBusinessKeys.slice(0, 50)) {
      lines.push(`- ${item.key} | rows=${item.rows.join(',')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function checkYear(
  driveApi: drive_v3.Drive,
  sheetsApi: any,
  spreadsheetId: string,
  year: string
): Promise<{ summary: YearSummary; markdown: string; folderRefs: Record<string, string>; mismatchFiles: YearMismatchFiles }> {
  const root = await findChildFolderByName(driveApi, DEFAULT_ACCOUNTING_ROOT, year);
  const incomeFolder = root ? await findChildFolderByName(driveApi, root.id, `Einnahmen_${year}`) : null;
  const expenseFolder = root ? await findChildFolderByName(driveApi, root.id, `Ausgaben_${year}`) : null;

  const [incomeDriveFiles, expenseDriveFiles, incomeSheetRows, expenseSheetRows] = await Promise.all([
    incomeFolder ? listFilesRecursiveWithPath(driveApi, incomeFolder.id, `${year}/${incomeFolder.name}`) : Promise.resolve([]),
    expenseFolder ? listFilesRecursiveWithPath(driveApi, expenseFolder.id, `${year}/${expenseFolder.name}`) : Promise.resolve([]),
    readSheetRows(sheetsApi, spreadsheetId, `Einnahmen_${year}`),
    readSheetRows(sheetsApi, spreadsheetId, `Ausgaben_${year}`)
  ]);

  const incomeResult = checkFlow('Einnahmen', incomeDriveFiles, incomeSheetRows);
  const expenseResult = checkFlow('Ausgaben', expenseDriveFiles, expenseSheetRows);

  const summary: YearSummary = {
    year,
    income: {
      driveCount: incomeResult.driveCount,
      sheetCount: incomeResult.sheetCount,
      driveOnly: incomeResult.driveOnly.length,
      sheetOnly: incomeResult.sheetOnly.length,
      duplicateDriveIdsInSheet: incomeResult.duplicateDriveIdsInSheet.length,
      potentialPrivateRows: incomeResult.potentialPrivateRows.length,
      potentialDuplicateBusinessKeys: incomeResult.potentialDuplicateBusinessKeys.length
    },
    expense: {
      driveCount: expenseResult.driveCount,
      sheetCount: expenseResult.sheetCount,
      driveOnly: expenseResult.driveOnly.length,
      sheetOnly: expenseResult.sheetOnly.length,
      duplicateDriveIdsInSheet: expenseResult.duplicateDriveIdsInSheet.length,
      potentialPrivateRows: expenseResult.potentialPrivateRows.length,
      potentialDuplicateBusinessKeys: expenseResult.potentialDuplicateBusinessKeys.length
    }
  };

  const mismatchDir = path.join(process.cwd(), 'docs', 'mismatch');
  fs.mkdirSync(mismatchDir, { recursive: true });
  const driveOnlyFullPath = path.join(mismatchDir, `${year}_drive_only.json`);
  const sheetOnlyFullPath = path.join(mismatchDir, `${year}_sheet_only.json`);
  const duplicateFullPath = path.join(mismatchDir, `${year}_duplicate_drive_ids.json`);
  fs.writeFileSync(
    driveOnlyFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.driveOnly,
        expense: expenseResult.driveOnly
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    sheetOnlyFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.sheetOnly,
        expense: expenseResult.sheetOnly
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    duplicateFullPath,
    JSON.stringify(
      {
        year,
        income: incomeResult.duplicateDriveIdsInSheet,
        expense: expenseResult.duplicateDriveIdsInSheet
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    summary,
    markdown: `${renderFlow(year, incomeResult)}\n${renderFlow(year, expenseResult)}`,
    folderRefs: {
      yearFolder: root?.id || '',
      incomeFolder: incomeFolder?.id || '',
      expenseFolder: expenseFolder?.id || ''
    },
    mismatchFiles: {
      driveOnlyFullPath,
      sheetOnlyFullPath,
      duplicateFullPath
    }
  };
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const driveApi = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const discoveredYears = await discoverAvailableYears(driveApi, DEFAULT_ACCOUNTING_ROOT);
  const years = parseYears(process.env.CHECK_YEARS, discoveredYears);

  const results = [] as Array<{ summary: YearSummary; markdown: string; folderRefs: Record<string, string>; mismatchFiles: YearMismatchFiles }>;
  for (const year of years) {
    results.push(await checkYear(driveApi, sheetsApi, spreadsheetId, year));
  }

  const reportLines: string[] = [];
  reportLines.push('# Letzter Konsistenzcheck (Drive vs Sheets)');
  reportLines.push('');
  reportLines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  reportLines.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  reportLines.push(`- Accounting Root: ${DEFAULT_ACCOUNTING_ROOT}`);
  reportLines.push(`- Geprüfte Jahre: ${years.join(', ')}`);
  reportLines.push('');

  for (const item of results) {
    reportLines.push(`### Ordner-Referenzen ${item.summary.year}`);
    reportLines.push('');
    reportLines.push(`- ${item.summary.year} Folder: ${item.folderRefs.yearFolder}`);
    reportLines.push(`- Einnahmen_${item.summary.year} Folder: ${item.folderRefs.incomeFolder}`);
    reportLines.push(`- Ausgaben_${item.summary.year} Folder: ${item.folderRefs.expenseFolder}`);
    reportLines.push('');
    reportLines.push(item.markdown);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');

  const summary = {
    timestamp: new Date().toISOString(),
    years,
    reportPath: REPORT_PATH,
    summaries: results.map((r) => r.summary),
    fullMismatchFiles: Object.fromEntries(
      results.map((r) => [r.summary.year, r.mismatchFiles])
    )
  };
  if (results.length === 1) {
    (summary as any).driveOnlyFullPath = results[0].mismatchFiles.driveOnlyFullPath;
    (summary as any).sheetOnlyFullPath = results[0].mismatchFiles.sheetOnlyFullPath;
    (summary as any).duplicateFullPath = results[0].mismatchFiles.duplicateFullPath;
  }

  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('check_2023_integrity failed:', error);
  process.exit(1);
});

```
