# Context Fulltext

- source_path: src/legacy/monolith/main.ts
- source_sha256: 1879dfb4721fc5b373a7285c1890147562a8a8ec1b9be62afdc899f6c9d1e95f
- chunk: 2/2

```text
ets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title } } }]
          }
        }),
        `syncFolderTabs.create.${title}`
      );
      const createdId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
      if (typeof createdId !== 'number') {
        throw new Error(`Could not create folder tab: ${title}`);
      }
      sheetId = createdId;
      sheetIdByTitle.set(title, createdId);
    }

    const rows: string[][] = [[
      'drive_file_id',
      'name',
      'mime_type',
      'size',
      'modified_time',
      'file_url',
      'folder_path'
    ]];

    const queue: Array<{ id: string; path: string }> = [{ id: folderId, path: name }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.id)) continue;
      visited.add(current.id);

      const children = await listFolderChildren(driveApi, current.id);
      for (const child of children) {
        const childId = child.id || '';
        const childName = child.name || childId;
        if (!childId) continue;
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: childId, path: `${current.path}/${childName}` });
        } else {
          rows.push([
            childId,
            childName,
            child.mimeType || '',
            child.size || '',
            child.modifiedTime || '',
            child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
            current.path
          ]);
        }
      }
    }

    await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.values.clear({
        spreadsheetId,
        range: `${title}!A:Z`
      }),
      `syncFolderTabs.clear.${title}`
    );

    await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      `syncFolderTabs.update.${title}`
    );

    await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 7
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true }
                  }
                },
                fields: 'userEnteredFormat.textFormat.bold'
              }
            },
            {
              setBasicFilter: {
                filter: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: Math.max(1, rows.length),
                    startColumnIndex: 0,
                    endColumnIndex: 7
                  }
                }
              }
            },
            {
              updateDimensionProperties: {
                range: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 1,
                  endIndex: 2
                },
                properties: { pixelSize: 300 },
                fields: 'pixelSize'
              }
            }
          ]
        }
      }),
      `syncFolderTabs.format.${title}`
    );
    synced++;
  }

  const staleFolderSheetIds = Array.from(sheetIdByTitle.entries())
    .filter(([title]) => title.startsWith('Ordner_') && !expectedTitles.has(title))
    .map(([, sheetId]) => sheetId);

  if (staleFolderSheetIds.length > 0) {
    await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: staleFolderSheetIds.map((sheetId) => ({
            deleteSheet: { sheetId }
          }))
        }
      }),
      'syncFolderTabs.deleteStale'
    );
  }

  return {
    synced,
    removed: staleFolderSheetIds.length
  };
}

withPipelineLock('main', main).catch(async (error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

```
