# Delta Fulltext

- source_path: src/orchestrator/final_acceptance_run.ts
- source_sha256: f0cfb52f2d0978f314e10b545c4c2f23fd4cc15c1768b9df8b29a7dfdb6ca58f
- chunk: 2/5

```text
 []) {
      for (const row of range.values || []) {
        for (const cell of row) {
          if (String(cell).includes('Fehler bei der PDF-Analyse')) forbiddenMarkerHits++;
        }
      }
    }
  }

  return {
    records: data.length,
    categories,
    tabs,
    forbiddenMarkerHits
  };
}

function selectStratifiedSample(rows: any[], sampleSize: number): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const year = extractYear(String(row.original_name || '')) || extractYear(String(row.analyzed_at || '')) || 'unknown';
    const category = String(row.category || '(leer)');
    const key = `${year}::${category}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const keys = Array.from(groups.keys()).sort();
  const sampled: any[] = [];
  const idx = new Map<string, number>();
  for (const key of keys) {
    const bucket = groups.get(key) || [];
    if (bucket.length > 0) {
      sampled.push(bucket[0]);
      idx.set(key, 1);
    } else {
      idx.set(key, 0);
    }
  }

  while (sampled.length < sampleSize) {
    let added = false;
    for (const key of keys) {
      const bucket = groups.get(key) || [];
      const current = idx.get(key) || 0;
      if (current < bucket.length) {
        sampled.push(bucket[current]);
        idx.set(key, current + 1);
        added = true;
        if (sampled.length >= sampleSize) break;
      }
    }
    if (!added) break;
  }

  return sampled.slice(0, sampleSize);
}

function assessQaIssue(row: any): QaIssue | null {
  const failures: string[] = [];
  const criticalFailures: string[] = [];

  const driveFileId = String(row.drive_file_id || '');
  const originalName = String(row.original_name || '');
  const category = String(row.category || '');
  const targetFolderId = String(row.target_folder_id || '');
  const fileUrl = String(row.file_url || '');

  if (!driveFileId) criticalFailures.push('missing_drive_file_id');
  if (!originalName) criticalFailures.push('missing_original_name');
  if (!category) criticalFailures.push('missing_category');
  if (!targetFolderId) criticalFailures.push('missing_target_folder_id');
  if (!fileUrl) criticalFailures.push('missing_file_url');

  const derivedYear = extractYear(originalName) || extractYear(String(row.analyzed_at || ''));
  if (!derivedYear) criticalFailures.push('invalid_year');

  const textBlob = `${row.extracted_text || ''} ${row.ocr_text || ''}`.trim();
  const metadata = String(row.metadata || '');
  const amountCandidates = textBlob.match(/\d+[\.,]\d{2}/g) || [];

  if (textBlob.length < 20) failures.push('weak_text_extraction');
  if (!metadata || metadata === '{}') failures.push('missing_metadata');
  if (amountCandidates.length === 0) {
    failures.push('missing_amount_pattern');
  } else {
    const maxAmount = Math.max(...amountCandidates.map(parseAmount));
    if (maxAmount <= 0) failures.push('invalid_amount_pattern');
  }

  const allFailures = [...criticalFailures, ...failures];
  if (allFailures.length === 0) return null;

  let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
  if (criticalFailures.length > 0) severity = 'CRITICAL';
  else if (failures.includes('missing_metadata') && amountCandidates.length > 0) severity = 'HIGH';

  return {
    drive_file_id: driveFileId,
    original_name: originalName,
    year: derivedYear || 'unknown',
    category,
    severity,
    failures: allFailures
  };
}

function runQualityCheck(belegeRows: any[], sampleSize: number): QaResult {
  const sampled = selectStratifiedSample(belegeRows, sampleSize);
  const issues: QaIssue[] = [];
  let criticalPassed = 0;
  for (const row of sampled) {
    const issue = assessQaIssue(row);
    if (!issue) {
      criticalPassed++;
      continue;
    }
    if (issue.severity !== 'CRITICAL') {
      criticalPassed++;
    }
    issues.push(issue);
  }

  const total = sampled.length;
  const accuracy = total === 0 ? 0 : criticalPassed / total;
  const criticalQaIssues = issues.filter((issue) => issue.severity === 'CRITICAL').length;
  return {
    total,
    criticalPassed,
    accuracy,
    criticalQaIssues,
    issues
  };
}

async function writeQaCriticalOpen(sheetsApi: any, spreadsheetId: string, issues: QaIssue[]): Promise<void> {
  const sheetMap = await getSheetMap(sheetsApi, spreadsheetId);
  await ensureSheetExists(sheetsApi, spreadsheetId, 'QA_CRITICAL_OPEN', sheetMap);

  const rows = [
    ['drive_file_id', 'original_name', 'year', 'category', 'severity', 'failures_json'],
    ...issues
      .filter((issue) => issue.severity === 'CRITICAL')
      .map((issue) => [
        issue.drive_file_id,
        issue.original_name,
        issue.year,
        issue.category,
        issue.severity,
        JSON.stringify(issue.failures)
      ])
  ];

  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: 'QA_CRITICAL_OPEN!A:Z'
    }),
    'writeQaCriticalOpen.clear'
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: 'QA_CRITICAL_OPEN!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    }),
    'writeQaCriticalOpen.update'
  );
}

function computeYearlyGateStatus(integritySummary: any): YearlyGateStatus[] {
  const rows = integritySummary?.summaries || [];
  return rows.map((yearly: any) => {
    const driveOnly = (yearly.income?.driveOnly || 0) + (yearly.expense?.driveOnly || 0);
    const sheetOnly = (yearly.income?.sheetOnly || 0) + (yearly.expense?.sheetOnly || 0);
    const duplicateDriveIds = (yearly.income?.duplicateDriveIdsInSheet || 0) + (yearly.expense?.duplicateDriveIdsInSheet || 0);
    return {
      year: String(yearly.year || ''),
      driveOnly,
      sheetOnly,
      duplicateDriveIds,
      pass: driveOnly === 0 && sheetOnly === 0 && duplicateDriveIds === 0
    };
  });
}

function buildSortKey(year: string, category: string, originalName: string, driveFileId: string): string {
  return `${year}|${category}|${originalName}|${driveFileId}`;
}

function mapRecordFromCanonical(
  canonical: CanonicalDriveFile,
  existing: BelegRecord | undefined,
  sourceFolderId: string,
  nowIso: string
): Partial<BelegRecord> {
  return {
    id: existing?.id || randomUUID(),
    drive_file_id: canonical.drive_file_id,
    original_name: canonical.original_name,
    mime_type: canonical.mime_type,
    file_size: canonical.file_size,
    category: canonical.category,
    extracted_text: existing?.extracted_text || '',
    ocr_text: existing?.ocr_text || '',
    image_description: existing?.image_description || '',
    tags: existing?.tags || '[]',
    metadata: existing?.metadata || '{}',
    confidence: Number(existing?.confidence || 0),
    source_folder_id: sourceFolderId,
    source_folder_url: `https://drive.google.com/drive/folders/${sourceFolderId}`,
    target_folder_id: canonical.target_folder_id,
    target_folder_url: canonical.target_folder_id ? `https://drive.google.com/drive/folders/${canonical.target_folder_id}` : '',
    analyzed_at: existing?.analyzed_at || nowIso,
    moved_at: existing?.moved_at || nowIso,
    file_url: canonical.file_url
  };
}

function buildYearlyRow(header: string[], entry: CanonicalDriveFile): string[] {
  const row = new Array(header.length).fill('');
  const set = (name: string, value: string) => {
    const idx = header.indexOf(name);
    if (idx >= 0) row[idx] = value;
  };
  set('Datum', `${entry.year}-01-01`);
  set('Typ', entry.cashflow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe');
  set('Kategorie', entry.category);
  set('Status', 'SYNCED');
  set('Bemerkung', 'AUTO_PROJECTION');
  set('Dateiname', entry.original_name);
  set('reason', 'AUTO_PROJECTION');
  set('drive_file_id', entry.drive_file_id);
  set('file_url', entry.file_url);
  return row;
}

function chooseCanonicalExisting(rows: BelegRecord[]): BelegRecord {
  return [...rows].sort((a, b) => {
    const aTs = Date.parse(a.analyzed_at || '');
    const bTs = Date.parse(b.analyzed_at || '');
    const aVal = Number.isFinite(aTs) ? aTs : Number.MAX_SAFE_INTEGER;
    const bVal = Number.isFinite(bTs) ? bTs : Number.MAX_SAFE_INTEGER;
    if (aVal !== bVal) return aVal - bVal;
    return (a.id || '').localeCompare(b.id || '');
  })[0];
}

async function buildCanonicalDriveIndex(
  driveApi: drive_v3.Drive,
  config: { sourceFolderId: string; targetFolderId: string; accountingRootFolderId: string }
): Promise<{ files: CanonicalDriveFile[]; physicalYears: string[] }> {
  const topLevelFolders = (await listChildren(driveApi, config.accountingRootFolderId)).filter(
    (item) => item.mimeType === 'application/vnd.google-apps.folder'
  );

  const physicalYears = Array.from(
    new Set(
      topLevelFolders
        .map((folder) => folder.name || '')
        .filter((name) => /^20\d{2}$/.test(name) && isValidYear(name))
    )
  ).sort();

  const roots = new Map<string, string>();
  roots.set(config.sourceFolderId, 'source');
  roots.set(config.targetFolderId, 'target');
  for (const folder of topLevelFolders) {
    const name = folder.name || '';
    const id = folder.id || '';
    if (!id) continue;
    const isYearFolder = /^20\d{2}$/.test(name) && isValidYear(name);
    const isAdditional = ['Sonstige_Belege', 'Neue Belege', 'Neue Belege '].includes(name);
    if (isYearFolder || isAdditional) {
      roots.set(id, name || id);
    }
  }

  const files: CanonicalDriveFile[] = [];
  const visited = new Set<string>();
  for (const [rootId, rootName] of roots.entries()) {
    const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: rootName }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const visitKey = `${rootId}:${current.id}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      if (current.id === DUPLICATE_FOLDER_ID || current.id === MISSING_FOLDER_ID) {
        continue;
      }

      const children = await listChildren(driveApi, current.id);
      for (const child of children) {
        const childId = child.id || '';
        const childName = child.name || childId;
        if (!childId) continue;
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: childId, path: `${current.path}/${childName}` });
          continue;
        }

        const pathYear = current.path
          .split('/')
          .map((segment) => segment.trim())
          .find((segment) => /^20\d{2}$/.test(segment) && isValidYear(segment));
        const nameYear = extractYear(childName);
        const resolvedYear = pathYear || nameYear || String(new Date().getFullYear());

        files.push({
          drive_file_id: childId,
          original_name: childName,
          mime_type: child.mimeType || '',
          file_size: Number.parseInt(child.size || '0', 10),
          file_url: child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
          folder_path: current.path,
          target_folder_id: current.id,
          year: resolvedYear,
          cashflow: inferCashflow(current.path, childName),
          category: inferCategory(current.path, childName)
        });
      }
    }
  }

  files.sort((a, b) =>
    buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(
      buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)
    )
  );

  return { files, physicalYears };
}

function canonicalEntriesForTab(files: CanonicalDriveFile[], year: string, flow: 'Einnahmen' | 'Ausgaben'): CanonicalDriveFile[] {
  const needle = `${year}/${flow}_${year}`.toLowerCase();
  const strict = files.filter((entry) => entry.folder_path.toLowerCase().includes(needle));
  if (strict.length > 0) {
    return strict.sort((a, b) => buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)));
```
