# Context Fulltext

- source_path: src/orchestrator/check_all_years_integrity.ts
- source_sha256: 34e7d0133b4e5ed376c952cf571428ee008692488fc7afdd3df1791a0d7ea956
- chunk: 2/2

```text
eck Alle Jahre (Drive vs Sheets)');
  lines.push('');
  lines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  lines.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  lines.push(`- Accounting Root: ${ACCOUNTING_ROOT_FOLDER_ID}`);
  lines.push(`- Jahre gefunden: ${yearFolders.map((y) => y.name).join(', ')}`);
  lines.push(`- Zero-Error gesamt: ${zeroError ? 'JA' : 'NEIN'}`);
  lines.push('');
  lines.push('| Jahr | Flow | Drive | Sheet | DriveOnly | SheetOnly | DupIDs | Privat | DupKeys | Tab |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const item of results) {
    lines.push(`| ${item.year} | ${item.flow} | ${item.driveCount} | ${item.sheetCount} | ${item.driveOnly} | ${item.sheetOnly} | ${item.duplicateDriveIdsInSheet} | ${item.potentialPrivateRows} | ${item.potentialDuplicateBusinessKeys} | ${item.sheetTabExists ? 'ok' : 'missing'} |`);
  }
  lines.push('');
  lines.push('## Summen');
  lines.push('');
  lines.push(`- Drive-Dateien: ${totals.driveCount}`);
  lines.push(`- Sheet-Zeilen: ${totals.sheetCount}`);
  lines.push(`- DriveOnly: ${totals.driveOnly}`);
  lines.push(`- SheetOnly: ${totals.sheetOnly}`);
  lines.push(`- Duplicate drive_file_id in Sheet: ${totals.duplicateDriveIdsInSheet}`);
  lines.push(`- Privatmarker: ${totals.potentialPrivateRows}`);
  lines.push(`- Duplikatkeys: ${totals.potentialDuplicateBusinessKeys}`);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    years: yearFolders.map((y) => y.name),
    totals,
    zeroError
  }, null, 2));
}

main().catch((error) => {
  console.error('check_all_years_integrity failed:', error);
  process.exit(1);
});

```
