# Context Fulltext

- source_path: src/orchestrator/post_closure_assurance.ts
- source_sha256: 602fcacbba26b203db126d38d8dc8945259a77f6645deb402a3571101152f917
- chunk: 2/5

```text
t row of rows) {
    out[row.year] = {
      driveOnly: row.driveOnly,
      sheetOnly: row.sheetOnly,
      duplicateIds: row.duplicateDriveIds
    };
  }
  return out;
}

function pickTopUnresolvedIds(report: FinalAcceptanceReport, limit: number): string[] {
  const ids = new Set<string>();

  const unresolvedPath = report.unresolvedIdsPath || '';
  if (unresolvedPath && fs.existsSync(unresolvedPath)) {
    const unresolved = readJsonIfExists<{ unresolved?: Record<string, string[]> }>(unresolvedPath);
    for (const rows of Object.values(unresolved?.unresolved || {})) {
      for (const id of rows) {
        if (id) ids.add(String(id));
        if (ids.size >= limit) return Array.from(ids.values());
      }
    }
  }

  const fullMismatch = report.integrity?.fullMismatchFiles || {};
  for (const ref of Object.values(fullMismatch)) {
    const driveOnly = ref.driveOnlyFullPath ? readJsonIfExists<any>(ref.driveOnlyFullPath) : null;
    for (const row of [...(driveOnly?.income || []), ...(driveOnly?.expense || [])]) {
      if (row?.id) ids.add(String(row.id));
      if (ids.size >= limit) return Array.from(ids.values());
    }

    const sheetOnly = ref.sheetOnlyFullPath ? readJsonIfExists<any>(ref.sheetOnlyFullPath) : null;
    for (const row of [...(sheetOnly?.income || []), ...(sheetOnly?.expense || [])]) {
      if (row?.driveFileId) ids.add(String(row.driveFileId));
      if (ids.size >= limit) return Array.from(ids.values());
    }

    const duplicates = ref.duplicateFullPath ? readJsonIfExists<any>(ref.duplicateFullPath) : null;
    for (const row of [...(duplicates?.income || []), ...(duplicates?.expense || [])]) {
      if (row?.driveFileId) ids.add(String(row.driveFileId));
      if (ids.size >= limit) return Array.from(ids.values());
    }
  }

  return Array.from(ids.values());
}

function ensureIncidentBranch(branchName: string): string {
  const shouldCreate = process.env.ASSURANCE_CREATE_INCIDENT_BRANCH !== '0';
  if (!shouldCreate) return 'skipped';

  const exists = spawnSync('git', ['rev-parse', '--verify', branchName], {
    cwd: process.cwd(),
    stdio: 'ignore'
  });
  if (exists.status === 0) {
    return 'exists';
  }

  const create = spawnSync('git', ['branch', branchName], {
    cwd: process.cwd(),
    stdio: 'pipe'
  });
  if (create.status === 0) {
    return 'created';
  }

  const stderr = String(create.stderr || '').trim();
  return stderr ? `failed:${stderr}` : 'failed';
}

function computeDefinitionFingerprint(): { fingerprint: string; files: string[] } {
  const hash = createHash('sha256');
  const files = DEFINITION_FILES.map((file) => path.join(process.cwd(), file));

  for (const filePath of files) {
    const relative = path.relative(process.cwd(), filePath);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return {
    fingerprint: hash.digest('hex'),
    files: files.map((file) => path.relative(process.cwd(), file))
  };
}

function entryFailed(entry: AssuranceHistoryEntry): boolean {
  return !entry.done;
}

function entryOperationalRed(entry: AssuranceHistoryEntry): boolean {
  if (!entry.done) return true;
  const kinds = new Set(entry.alertKinds || []);
  return kinds.has('schema') || kinds.has('drive_drift');
}

function extractYear(record: Partial<BelegRecord>): string {
  const source = `${record.original_name || ''} ${record.analyzed_at || ''}`;
  let bestYear = 'unknown';
  const matches = source.matchAll(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/g);
  for (const match of matches) {
    const y = Number.parseInt(match[1], 10);
    if (y >= 2000 && y <= new Date().getFullYear() + 1) {
      bestYear = String(y);
      break;
    }
  }
  return bestYear;
}

function selectStratifiedSample(rows: Partial<BelegRecord>[], size: number): SampleRow[] {
  const grouped = new Map<string, Partial<BelegRecord>[]>();
  for (const row of rows) {
    const year = extractYear(row);
    const category = String(row.category || 'Unkategorisiert');
    const key = `${year}::${category}`;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const orderedKeys = Array.from(grouped.keys()).sort();
  for (const key of orderedKeys) {
    const sorted = (grouped.get(key) || []).sort((a, b) => String(a.drive_file_id || '').localeCompare(String(b.drive_file_id || '')));
    grouped.set(key, sorted);
  }

  const picks: Partial<BelegRecord>[] = [];
  const cursor = new Map<string, number>();

  for (const key of orderedKeys) {
    const bucket = grouped.get(key) || [];
    if (bucket.length > 0) {
      picks.push(bucket[0]);
      cursor.set(key, 1);
    } else {
      cursor.set(key, 0);
    }
    if (picks.length >= size) break;
  }

  while (picks.length < size) {
    let added = false;
    for (const key of orderedKeys) {
      const bucket = grouped.get(key) || [];
      const idx = cursor.get(key) || 0;
      if (idx < bucket.length) {
        picks.push(bucket[idx]);
        cursor.set(key, idx + 1);
        added = true;
        if (picks.length >= size) break;
      }
    }
    if (!added) break;
  }

  return picks.slice(0, size).map((row) => ({
    drive_file_id: String(row.drive_file_id || ''),
    original_name: String(row.original_name || ''),
    year: extractYear(row),
    category: String(row.category || ''),
    file_url: String(row.file_url || ''),
    target_folder_id: String(row.target_folder_id || ''),
    review_checklist: [
      'Datum gegen Dokument verifizieren',
      'Betrag gegen Dokument verifizieren',
      'Kategorie gegen Ordner/Beleginhalt verifizieren',
      'Gegenpartei korrekt erfasst?'
    ]
  }));
}

function writeDailyKpi(report: FinalAcceptanceReport): string {
  const day = isoDate(report.timestamp);
  const payload = {
    date: day,
    runId: report.runId,
    done: report.done,
    scopeYears: report.scopeYears,
    records: report.after.records,
    categories: report.after.categories,
    kpis: report.kpis,
    hardFailReasons: report.hardFailReasons
  };

  const jsonPath = path.join(DAILY_DIR, `DAILY_KPI_${day}.json`);
  const mdPath = path.join(DAILY_DIR, `DAILY_KPI_${day}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Daily KPI ${day}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- done: ${report.done}`);
  lines.push(`- records: ${report.after.records}`);
  lines.push(`- driveOnly: ${report.kpis.totalDriveOnly}`);
  lines.push(`- sheetOnly: ${report.kpis.totalSheetOnly}`);
  lines.push(`- duplicateIds: ${report.kpis.totalDuplicateIds}`);
  lines.push(`- forbiddenMarkerHits: ${report.kpis.forbiddenMarkerHits}`);
  lines.push(`- qaAccuracy: ${(report.kpis.qaAccuracy * 100).toFixed(2)}%`);
  lines.push(`- criticalQaIssues: ${report.kpis.criticalQaIssues}`);
  lines.push(`- idempotencyPass: ${report.kpis.idempotencyPass}`);
  lines.push(`- dashboardFormulaDriftCount: ${report.kpis.dashboardFormulaDriftCount}`);
  lines.push(`- dashboardValueDriftCount: ${report.kpis.dashboardValueDriftCount}`);
  lines.push(`- bidirectionalDriftIncidents: ${report.kpis.bidirectionalDriftIncidents}`);
  lines.push('');
  lines.push('## Categories');
  lines.push('');
  for (const [category, count] of Object.entries(report.after.categories).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${category}: ${count}`);
  }
  if (report.hardFailReasons.length > 0) {
    lines.push('');
    lines.push('## Hard Fail Reasons');
    lines.push('');
    for (const reason of report.hardFailReasons) {
      lines.push(`- ${reason}`);
    }
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  return jsonPath;
}

function buildWeeklyTrend(history: AssuranceHistoryEntry[], nowIso: string): { jsonPath: string; mdPath: string } {
  const week = toIsoWeek(nowIso);
  const cutoff = Date.parse(nowIso) - (7 * 24 * 60 * 60 * 1000);
  const windowRows = history.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  const sorted = [...windowRows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const categoryDelta: Record<string, number> = {};
  if (first && last) {
    const keys = new Set([...Object.keys(first.categories || {}), ...Object.keys(last.categories || {})]);
    for (const key of keys) {
      categoryDelta[key] = (last.categories[key] || 0) - (first.categories[key] || 0);
    }
  }

  const yearDelta: Record<string, YearGateCounter> = {};
  if (first && last) {
    const keys = new Set([...Object.keys(first.yearCounters || {}), ...Object.keys(last.yearCounters || {})]);
    for (const key of keys) {
      const before = first.yearCounters[key] || { driveOnly: 0, sheetOnly: 0, duplicateIds: 0 };
      const after = last.yearCounters[key] || { driveOnly: 0, sheetOnly: 0, duplicateIds: 0 };
      yearDelta[key] = {
        driveOnly: after.driveOnly - before.driveOnly,
        sheetOnly: after.sheetOnly - before.sheetOnly,
        duplicateIds: after.duplicateIds - before.duplicateIds
      };
    }
  }

  const failRuns = sorted.filter((entry) => entryFailed(entry)).length;
  const payload = {
    week,
    generatedAt: nowIso,
    runsInWindow: sorted.length,
    failRuns,
    passRate: sorted.length === 0 ? 0 : (sorted.length - failRuns) / sorted.length,
    fromRunId: first?.runId || null,
    toRunId: last?.runId || null,
    fromReportTimestamp: first?.reportTimestamp || null,
    toReportTimestamp: last?.reportTimestamp || null,
    kpiDelta: first && last ? {
      driveOnly: last.kpis.totalDriveOnly - first.kpis.totalDriveOnly,
      sheetOnly: last.kpis.totalSheetOnly - first.kpis.totalSheetOnly,
      duplicateIds: last.kpis.totalDuplicateIds - first.kpis.totalDuplicateIds,
      forbiddenMarkerHits: last.kpis.forbiddenMarkerHits - first.kpis.forbiddenMarkerHits,
      qaAccuracy: Number((last.kpis.qaAccuracy - first.kpis.qaAccuracy).toFixed(4))
    } : null,
    categoryDelta,
    yearDelta
  };

  const jsonPath = path.join(WEEKLY_DIR, `WEEKLY_TREND_${week}.json`);
  const mdPath = path.join(WEEKLY_DIR, `WEEKLY_TREND_${week}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Weekly Trend ${week}`);
  lines.push('');
  lines.push(`- generatedAt: ${nowIso}`);
  lines.push(`- runsInWindow: ${payload.runsInWindow}`);
  lines.push(`- failRuns: ${payload.failRuns}`);
  lines.push(`- passRate: ${(payload.passRate * 100).toFixed(2)}%`);
  lines.push(`- fromRunId: ${payload.fromRunId || 'n/a'}`);
  lines.push(`- toRunId: ${payload.toRunId || 'n/a'}`);
  lines.push('');
  if (payload.kpiDelta) {
    lines.push('## KPI Delta');
    lines.push('');
    lines.push(`- driveOnly: ${payload.kpiDelta.driveOnly}`);
    lines.push(`- sheetOnly: ${payload.kpiDelta.sheetOnly}`);
    lines.push(`- duplicateIds: ${payload.kpiDelta.duplicateIds}`);
    lines.push(`- forbiddenMarkerHits: ${payload.kpiDelta.forbiddenMarkerHits}`);
    lines.push(`- qaAccuracy: ${payload.kpiDelta.qaAccuracy}`);
    lines.push('');
  }
  lines.push('## Category Delta');
  lines.push('');
  for (const [category, delta] of Object.entries(categoryDelta).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${category}: ${delta}`);
  }
  lines.push('');
  lines.push('## Year Delta');
  lines.push('');
  for (const [year, delta] of Object.entries(yearDelta).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${year}: driveOnly=${delta.driveOnly}, sheetOnly=${delta.sheetOnly}, duplicateIds=${delta.duplicateIds}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath };
}

function writeIncidentArtifacts(report: FinalAcceptanceReport, alertKinds: AssuranceAlertKind[]): { jsonPath: string; mdPath: string; incidentBranch: string } {
  const tag = `${isoDate(report.timestamp)}_${report.runId}`;
  const incidentB
```
