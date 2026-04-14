# Context Fulltext

- source_path: src/orchestrator/micro_sync_drive_changes.ts
- source_sha256: 095138a2bbf13a2ded4c16ef54418e03f96114bf2d012fd5b497c76604b87ed0
- chunk: 2/2

```text
 string[][] = [];

  for (const fileId of removedIds) {
    const row = belege.rowByDriveId.get(fileId);
    if (!row) continue;
    clears.push(`belege!A${row}:S${row}`);
  }

  const idxOriginalName = belege.headerMap.get('original_name') ?? -1;
  const idxMime = belege.headerMap.get('mime_type') ?? -1;
  const idxSize = belege.headerMap.get('file_size') ?? -1;
  const idxTargetFolderId = belege.headerMap.get('target_folder_id') ?? -1;
  const idxTargetFolderUrl = belege.headerMap.get('target_folder_url') ?? -1;
  const idxMovedAt = belege.headerMap.get('moved_at') ?? -1;
  const idxFileUrl = belege.headerMap.get('file_url') ?? -1;

  for (const file of upserts) {
    const fileId = String(file.id || '').trim();
    if (!fileId) continue;
    const existingRow = belege.rowByDriveId.get(fileId);
    if (!existingRow) {
      appends.push(buildBelegeRowFromFile(file));
      continue;
    }
    const nowIso = new Date().toISOString();
    const parentId = file.parents?.[0] || '';
    const fields = [
      [idxOriginalName, String(file.name || '')],
      [idxMime, String(file.mimeType || '')],
      [idxSize, String(file.size || '0')],
      [idxTargetFolderId, parentId],
      [idxTargetFolderUrl, parentId ? `https://drive.google.com/drive/folders/${parentId}` : ''],
      [idxMovedAt, nowIso],
      [idxFileUrl, String(file.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''))]
    ] as Array<[number, string]>;
    const validFields = fields.filter(isValidFieldTuple);

    for (const [idx, value] of validFields) {
      const col = colLetter(idx);
      updates.push({ range: `belege!${col}${existingRow}`, values: [[value]] });
    }
  }

  if (clears.length > 0) {
    await apiCall(
      'sheets.values.batchClear',
      () => sheets.spreadsheets.values.batchClear({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { ranges: clears }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }
  if (updates.length > 0) {
    await apiCall(
      'sheets.values.batchUpdate',
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
  if (appends.length > 0) {
    await apiCall(
      'sheets.values.append',
      () => sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'belege!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appends }
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
  }

  const lines: string[] = [];
  lines.push('# MICRO Sync Drive Changes');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Changes fetched: ${fetchedChanges}`);
  lines.push(`- Removed rows cleared: ${clears.length}`);
  lines.push(`- Updated rows: ${updates.length}`);
  lines.push(`- Appended rows: ${appends.length}`);
  lines.push(`- Next page token saved: [REDACTED]
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    runId,
    fetchedChanges,
    clearedRows: clears.length,
    updatedCells: updates.length,
    appendedRows: appends.length,
    reportPath: REPORT_PATH
  }, null, 2));
  eventLog('run_success', {
    runId,
    elapsedMs: Date.now() - startedAt,
    fetchedChanges,
    clearedRows: clears.length,
    updatedCells: updates.length,
    appendedRows: appends.length
  });
}

withPipelineLock('micro_sync_drive_changes', main).catch((e) => {
  eventLog('run_error', {
    error: e instanceof Error ? e.message : String(e)
  });
  console.error(e);
  process.exit(1);
});

```
