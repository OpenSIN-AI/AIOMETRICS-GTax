# Context Fulltext

- source_path: src/orchestrator/final_acceptance_run.ts
- source_sha256: f0cfb52f2d0978f314e10b545c4c2f23fd4cc15c1768b9df8b29a7dfdb6ca58f
- chunk: 3/5

```text

  }
  return files
    .filter((entry) => entry.year === year && entry.cashflow === flow)
    .sort((a, b) => buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)));
}

async function resolveMismatches(params: {
  runId: string;
  nowIso: string;
  sheetsApi: any;
  spreadsheetId: string;
  sheetsService: GoogleSheetsService;
  canonicalFiles: CanonicalDriveFile[];
  scopeYears: string[];
  sourceFolderId: string;
}): Promise<MismatchResolutionStats> {
  const actionPriority: Record<MismatchActionType, number> = {
    DELETE_DUPLICATE: 1,
    DELETE_ORPHAN: 2,
    DELETE_YEARLY_ORPHAN: 3,
    INSERT_MISSING: 4,
    INSERT_YEARLY_MISSING: 5,
    UPDATE_YEAR: 6,
    UPDATE_CATEGORY: 7
  };

  const existingRecords = await params.sheetsService.getAllBelege();
  const existingById = new Map<string, BelegRecord[]>();
  for (const record of existingRecords) {
    const bucket = existingById.get(record.drive_file_id) || [];
    bucket.push(record);
    existingById.set(record.drive_file_id, bucket);
  }

  const canonicalById = new Map<string, CanonicalDriveFile>();
  for (const file of params.canonicalFiles) {
    canonicalById.set(file.drive_file_id, file);
  }

  const actions: MismatchAction[] = [];
  const finalBelege: Partial<BelegRecord>[] = [];

  for (const file of params.canonicalFiles) {
    const rows = existingById.get(file.drive_file_id) || [];
    const canonicalExisting = rows.length > 0 ? chooseCanonicalExisting(rows) : undefined;
    const nextRecord = mapRecordFromCanonical(file, canonicalExisting, params.sourceFolderId, params.nowIso);
    finalBelege.push(nextRecord);

    if (!canonicalExisting) {
      actions.push({
        type: 'INSERT_MISSING',
        reason: 'MISSING_IN_SHEET',
        target: 'belege',
        driveFileId: file.drive_file_id,
        scopeYear: file.year,
        sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
        before: {},
        after: nextRecord as Record<string, unknown>
      });
    } else {
      const oldYear = extractYear(canonicalExisting.original_name || '') || extractYear(canonicalExisting.analyzed_at || '') || '0000';
      if (oldYear !== file.year) {
        actions.push({
          type: 'UPDATE_YEAR',
          reason: 'YEAR_MISMATCH',
          target: 'belege',
          driveFileId: file.drive_file_id,
          scopeYear: file.year,
          sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
          before: { year: oldYear, original_name: canonicalExisting.original_name },
          after: { year: file.year, original_name: file.original_name }
        });
      }
      if ((canonicalExisting.category || '') !== file.category) {
        actions.push({
          type: 'UPDATE_CATEGORY',
          reason: 'CATEGORY_MISMATCH',
          target: 'belege',
          driveFileId: file.drive_file_id,
          scopeYear: file.year,
          sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
          before: { category: canonicalExisting.category || '' },
          after: { category: file.category }
        });
      }
      if (rows.length > 1) {
        for (const duplicate of rows.filter((r) => r.id !== canonicalExisting.id)) {
          actions.push({
            type: 'DELETE_DUPLICATE',
            reason: 'DUPLICATE_DRIVE_ID',
            target: 'belege',
            driveFileId: file.drive_file_id,
            scopeYear: file.year,
            sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
            before: duplicate as unknown as Record<string, unknown>,
            after: canonicalExisting as unknown as Record<string, unknown>
          });
        }
      }
    }
  }

  for (const record of existingRecords) {
    if (!record.drive_file_id || canonicalById.has(record.drive_file_id)) continue;
    const orphanYear = extractYear(record.original_name || '') || extractYear(record.analyzed_at || '') || '0000';
    actions.push({
      type: 'DELETE_ORPHAN',
      reason: 'ORPHAN_IN_SHEET',
      target: 'belege',
      driveFileId: record.drive_file_id,
      scopeYear: orphanYear,
      sortKey: buildSortKey(orphanYear, record.category || 'Sonstiges', record.original_name || '', record.drive_file_id),
      before: record as unknown as Record<string, unknown>,
      after: {}
    });
  }

  await params.sheetsService.replaceAllBelege(finalBelege);

  const expectedTabs = params.scopeYears.flatMap((year) => [`Einnahmen_${year}`, `Ausgaben_${year}`]).sort();
  const existingYearlyTabs = await params.sheetsService.listYearlyTabs();
  const staleGeneratedTabs = existingYearlyTabs.filter(
    (tab) => !expectedTabs.includes(tab) && !/_Legacy_/i.test(tab)
  );

  const sheetMap = await getSheetMap(params.sheetsApi, params.spreadsheetId);
  if (staleGeneratedTabs.length > 0) {
    const deleteRequests = staleGeneratedTabs
      .map((title) => sheetMap.get(title))
      .filter((id): id is number => typeof id === 'number')
      .map((sheetId) => ({ deleteSheet: { sheetId } }));
    if (deleteRequests.length > 0) {
      await runWithRateLimitRetry(
        () => params.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: params.spreadsheetId,
          requestBody: { requests: deleteRequests }
        }),
        'resolveMismatches.deleteStaleYearTabs'
      );
      for (const tab of staleGeneratedTabs) sheetMap.delete(tab);
    }
  }

  let yearlyTabsTouched = 0;
  for (const tab of expectedTabs) {
    const flow = tab.startsWith('Einnahmen_') ? 'Einnahmen' : 'Ausgaben';
    const year = tab.slice(-4);
    const desired = canonicalEntriesForTab(params.canonicalFiles, year, flow);
    const currentRows: YearlyTabRow[] = existingYearlyTabs.includes(tab)
      ? await params.sheetsService.readYearlyRows(tab)
      : [];

    const currentIds = new Set(currentRows.map((row) => row.drive_file_id));
    const desiredIds = new Set(desired.map((row) => row.drive_file_id));

    for (const row of currentRows) {
      if (!desiredIds.has(row.drive_file_id)) {
        actions.push({
          type: 'DELETE_YEARLY_ORPHAN',
          reason: 'ORPHAN_IN_SHEET',
          target: 'yearly_tabs',
          driveFileId: row.drive_file_id,
          scopeYear: year,
          sortKey: buildSortKey(year, 'yearly', tab, row.drive_file_id),
          before: { tab, rowNumber: row.rowNumber, row: row.raw },
          after: {}
        });
      }
    }

    for (const file of desired) {
      if (!currentIds.has(file.drive_file_id)) {
        actions.push({
          type: 'INSERT_YEARLY_MISSING',
          reason: 'MISSING_IN_SHEET',
          target: 'yearly_tabs',
          driveFileId: file.drive_file_id,
          scopeYear: year,
          sortKey: buildSortKey(year, file.category, file.original_name, file.drive_file_id),
          before: {},
          after: { tab, drive_file_id: file.drive_file_id }
        });
      }
    }

    await ensureSheetExists(params.sheetsApi, params.spreadsheetId, tab, sheetMap);
    const headerRead: any = await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.get({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!1:1`
      }),
      `resolveMismatches.readHeader.${tab}`
    );
    let header = (headerRead.data.values?.[0] || []).map((x: string) => String(x || '').trim());
    if (header.length === 0 || !header.includes('drive_file_id')) {
      header = [...DEFAULT_YEARLY_HEADERS];
    }

    const rows = [
      header,
      ...desired.map((entry) => buildYearlyRow(header, entry))
    ];

    await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.clear({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!A:ZZ`
      }),
      `resolveMismatches.clear.${tab}`
    );
    await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.update({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      `resolveMismatches.update.${tab}`
    );
    yearlyTabsTouched++;
  }

  actions.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    const pa = actionPriority[a.type];
    const pb = actionPriority[b.type];
    if (pa !== pb) return pa - pb;
    return a.driveFileId.localeCompare(b.driveFileId);
  });

  const auditRows: AuditMutationRecord[] = actions.map((action) => ({
    run_id: params.runId,
    timestamp: params.nowIso,
    action: action.type,
    target: action.target,
    drive_file_id: action.driveFileId,
    before_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.before }),
    after_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.after }),
    reason: action.reason
  }));

  const chunkSize = 300;
  for (let i = 0; i < auditRows.length; i += chunkSize) {
    await params.sheetsService.appendAuditMutations(auditRows.slice(i, i + chunkSize));
  }

  const actionsByType: Record<string, number> = {};
  const actionsByYear: Record<string, number> = {};
  for (const action of actions) {
    actionsByType[action.type] = (actionsByType[action.type] || 0) + 1;
    actionsByYear[action.scopeYear] = (actionsByYear[action.scopeYear] || 0) + 1;
  }

  await params.sheetsService.logProcessing(
    '',
    'mismatch_resolve',
    'success',
    `run=${params.runId}, actions=${actions.length}, belegeBefore=${existingRecords.length}, belegeAfter=${finalBelege.length}, staleTabsDeleted=${staleGeneratedTabs.length}`
  );

  return {
    belegeBefore: existingRecords.length,
    belegeAfter: finalBelege.length,
    yearlyTabsTouched,
    staleYearTabsDeleted: staleGeneratedTabs,
    actionsTotal: actions.length,
    actionsByType,
    actionsByYear
  };
}

async function runStage(stageResults: StageResult[], stageName: string, fn: () => Promise<void>, canRun: boolean): Promise<boolean> {
  if (!canRun) {
    stageResults.push({
      stage: stageName,
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      error: 'SKIPPED_DUE_TO_PREVIOUS_FAILURE'
    });
    return false;
  }

  const startedAt = new Date().toISOString();
  const startedTs = Date.now();
  try {
    await fn();
    stageResults.push({
      stage: stageName,
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedTs
    });
    return true;
  } catch (error: any) {
    stageResults.push({
      stage: stageName,
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedTs,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function main() {
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const sourceFolderId = process.env.SOURCE_DRIVE_FOLDER_ID || DEFAULT_SOURCE_FOLDER;
  const targetFolderId = process.env.TARGET_DRIVE_FOLDER_ID || DEFAULT_TARGET_FOLDER;
  const accountingRootFolderId = process.env.ACCOUNTING_ROOT_FOLDER_ID || DEFAULT_ACCOUNTING_ROOT;
  const sampleSize = Number.parseInt(process.env.QA_SAMPLE_SIZE || '80', 10);
  const maxLoops = Math.max(1, Number.parseInt(process.env.ACCEPTANCE_MAX_LOOPS || '1', 10));

  const runId = randomUUID();
  const reportMdPath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_REPORT.md');
  const reportJsonPath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_REPORT.json');
  const baselinePath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_BASELINE.json');
  const unresolvedPath = path.join(process.cwd(), 'docs', `UNRESOLVED_IDS_${runId}.json`);

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'http
```
