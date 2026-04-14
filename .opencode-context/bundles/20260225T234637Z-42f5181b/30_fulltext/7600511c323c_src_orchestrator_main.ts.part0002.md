# Context Fulltext

- source_path: src/orchestrator/main.ts
- source_sha256: 3110a841cedd0bba4e2fd3f980d85d4fc0b99412c60d15e39c06d46c9ef2d3de
- chunk: 2/2

```text
, unknown>,
          sortKey: buildSortKey(file.id, nextRecord, file.name, category)
        });
      } else {
        if (existingCategory && categoryFromFolder && existingCategory !== categoryFromFolder) {
          reconcileActions.push({
            type: 'UPDATE_CATEGORY',
            reason: 'CATEGORY_MISMATCH',
            target: 'belege',
            driveFileId: file.id,
            scopeYear: getYear(file.name || '') || getYear(nextRecord.analyzed_at || '') || '0000',
            before: { category: existingCategory },
            after: { category: categoryFromFolder },
            sortKey: buildSortKey(file.id, nextRecord, file.name, category)
          });
        }
        const oldYear = getYear(existing.original_name || '') || getYear(existing.analyzed_at || '');
        const newYear = getYear(file.name || '') || oldYear;
        if (oldYear && newYear && oldYear !== newYear) {
          reconcileActions.push({
            type: 'UPDATE_YEAR',
            reason: 'YEAR_MISMATCH',
            target: 'belege',
            driveFileId: file.id,
            scopeYear: newYear,
            before: { year: oldYear, original_name: existing.original_name },
            after: { year: newYear, original_name: file.name },
            sortKey: buildSortKey(file.id, nextRecord, file.name, category)
          });
        }
      }

      return nextRecord;
    })
    .sort((a, b) => (a.original_name || '').localeCompare(b.original_name || ''));

  for (const record of existingRecords) {
    if (!record.drive_file_id || driveFilesById.has(record.drive_file_id)) continue;
    reconcileActions.push({
      type: 'DELETE_ORPHAN',
      reason: 'ORPHAN_IN_SHEET',
      target: 'belege',
      driveFileId: record.drive_file_id,
      scopeYear: getYear(record.original_name || '') || getYear(record.analyzed_at || '') || '0000',
      before: record as unknown as Record<string, unknown>,
      after: {},
      sortKey: buildSortKey(record.drive_file_id, record, record.original_name || '', record.category || '')
    });
  }

  reconcileActions.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    const pa = actionPriority[a.type];
    const pb = actionPriority[b.type];
    if (pa !== pb) return pa - pb;
    return a.driveFileId.localeCompare(b.driveFileId);
  });

  const auditMutations: AuditMutationRecord[] = reconcileActions.map((action) => ({
    run_id: runId,
    timestamp: nowIso,
    action: action.type,
    target: action.target,
    drive_file_id: action.driveFileId,
    before_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.before }),
    after_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.after }),
    reason: action.reason
  }));

  await sheets.replaceAllBelege(reconciled);
  if (auditMutations.length > 0) {
    await sheets.appendAuditMutations(auditMutations);
  }
  const countsByReason = new Map<string, number>();
  for (const action of reconcileActions) {
    countsByReason.set(action.reason, (countsByReason.get(action.reason) || 0) + 1);
  }
  const reasonSummary = Array.from(countsByReason.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(',');
  await sheets.logProcessing(
    '',
    'reconcile_audit',
    'success',
    `run=${runId}, mutations=${auditMutations.length}, reasons=${reasonSummary || 'none'}`
  );
  return reconciled;
}

function folderTabTitle(name: string): string {
  return `Ordner_${name}`.replace(/[\[\]\*\?\/\\]/g, '_').slice(0, 95);
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = attempt * 2500;
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function listFolderChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined = undefined;

  do {
    const listResponse: any = await driveApi.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: [REDACTED]
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(listResponse.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);

  return out;
}

async function createGoogleApis(credentialsPath: [REDACTED]
  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  return {
    driveApi: google.drive({ version: 'v3', auth }),
    sheetsApi: google.sheets({ version: 'v4', auth })
  };
}

async function syncFolderTabs(
  credentialsPath: [REDACTED]
  spreadsheetId: string,
  rootFolderId: string
): Promise<{ synced: number; removed: number }> {
  const { driveApi, sheetsApi } = await createGoogleApis(credentialsPath);
  const spreadsheet = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  });

  const sheetIdByTitle = new Map<string, number>();
  for (const sheet of spreadsheet.data.sheets || []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && typeof sheetId === 'number') {
      sheetIdByTitle.set(title, sheetId);
    }
  }

  const topLevel = (await listFolderChildren(driveApi, rootFolderId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  const expectedTitles = new Set<string>();
  let synced = 0;

  for (const folder of topLevel) {
    const name = folder.name || folder.id || 'Unbenannt';
    const folderId = folder.id || '';
    if (!folderId) continue;

    const title = folderTabTitle(name);
    expectedTitles.add(title);

    let sheetId = sheetIdByTitle.get(title);
    if (typeof sheetId !== 'number') {
      const created = await runWithRateLimitRetry(
        () => sheetsApi.spreadsheets.batchUpdate({
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
