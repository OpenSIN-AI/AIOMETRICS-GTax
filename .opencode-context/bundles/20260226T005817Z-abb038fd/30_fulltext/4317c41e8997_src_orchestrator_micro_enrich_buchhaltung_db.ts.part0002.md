# Context Fulltext

- source_path: src/orchestrator/micro_enrich_buchhaltung_db.ts
- source_sha256: c1cc29afe07d0f7071c3794aee35019617d92d4e51c1f975b0bfd5f34c4c1495
- chunk: 2/2

```text
gorie || '' });
    } else {
      appends.push(rowValues);
      processed.push({ drive_file_id: driveId, action: 'append', belegart: rowObj.belegart || '', steuerkategorie: rowObj.steuerkategorie || '' });
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
    });
  }
  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Buchhaltung_DB!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends }
    });
  }

  const lines: string[] = [];
  lines.push('# MICRO Enrich Buchhaltung_DB');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Candidates: ${candidates.length}`);
  lines.push(`- Skipped due budget: ${skippedBudget}`);
  lines.push(`- Updated rows: ${updates.length}`);
  lines.push(`- Appended rows: ${appends.length}`);
  lines.push('');
  lines.push('| drive_file_id | action | belegart | steuerkategorie |');
  lines.push('|---|---|---|---|');
  for (const p of processed) {
    lines.push(`| ${p.drive_file_id} | ${p.action} | ${p.belegart} | ${p.steuerkategorie} |`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    elapsedMs: Date.now() - runStart,
    candidates: candidates.length,
    skippedBudget,
    updatedRows: updates.length,
    appendedRows: appends.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_enrich_buchhaltung_db', main).catch((e) => {
  console.error(e);
  process.exit(1);
});

```
