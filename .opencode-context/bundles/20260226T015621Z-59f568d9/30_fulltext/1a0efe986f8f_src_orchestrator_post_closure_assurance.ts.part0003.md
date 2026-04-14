# Context Fulltext

- source_path: src/orchestrator/post_closure_assurance.ts
- source_sha256: 602fcacbba26b203db126d38d8dc8945259a77f6645deb402a3571101152f917
- chunk: 3/5

```text
ranch = `incident/${tag}`;
  const incidentBranchStatus = ensureIncidentBranch(incidentBranch);
  const unresolvedTop = pickTopUnresolvedIds(report, 100);
  const stageFailures = report.stages.filter((stage) => !stage.ok).map((stage) => ({
    stage: stage.stage,
    error: stage.error || ''
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    incidentBranch,
    incidentBranchStatus,
    alertKinds,
    hardFailReasons: report.hardFailReasons,
    stageFailures,
    unresolvedTop,
    actionPlan: [
      'Ursache klassifizieren (quota/schema/drive drift/parser drift)',
      'Reconcile erneut laufen lassen',
      'Wenn nach 2 Läufen nicht grün: blocker dokumentieren und Top-IDs priorisieren'
    ]
  };

  const jsonPath = path.join(INCIDENT_DIR, `INCIDENT_${tag}.json`);
  const mdPath = path.join(INCIDENT_DIR, `INCIDENT_${tag}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Incident ${tag}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- incidentBranch: ${incidentBranch}`);
  lines.push(`- incidentBranchStatus: ${incidentBranchStatus}`);
  lines.push(`- alertKinds: ${alertKinds.join(', ')}`);
  lines.push('');
  lines.push('## Hard Fail Reasons');
  lines.push('');
  for (const reason of report.hardFailReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Stage Failures');
  lines.push('');
  for (const stage of stageFailures) {
    lines.push(`- ${stage.stage}: ${stage.error}`);
  }
  lines.push('');
  lines.push('## Top Unresolved IDs');
  lines.push('');
  for (const id of unresolvedTop) {
    lines.push(`- ${id}`);
  }
  lines.push('');
  lines.push('## Action Plan');
  lines.push('');
  for (const item of payload.actionPlan) {
    lines.push(`- ${item}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath, incidentBranch };
}

function writeBlockerArtifacts(report: FinalAcceptanceReport, consecutiveRedRuns: number, incidentBranch: string): { jsonPath: string; mdPath: string } {
  const tag = `${isoDate(report.timestamp)}_${report.runId}`;
  const unresolvedTop = pickTopUnresolvedIds(report, 100);

  const payload = {
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    incidentBranch,
    consecutiveRedRuns,
    blockerReasons: report.hardFailReasons,
    unresolvedTop
  };

  const jsonPath = path.join(INCIDENT_DIR, `BLOCKER_${tag}.json`);
  const mdPath = path.join(INCIDENT_DIR, `BLOCKER_${tag}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Blocker ${tag}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- incidentBranch: ${incidentBranch}`);
  lines.push(`- consecutiveRedRuns: ${consecutiveRedRuns}`);
  lines.push('');
  lines.push('## Blocker Reasons');
  lines.push('');
  for (const reason of report.hardFailReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Top Unresolved IDs');
  lines.push('');
  for (const id of unresolvedTop) {
    lines.push(`- ${id}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath };
}

function buildReviewRows(sampleRows: SampleRow[]): ReviewRow[] {
  return sampleRows.map((row) => ({
    drive_file_id: row.drive_file_id,
    original_name: row.original_name,
    datum_ok: null,
    betrag_ok: null,
    category_ok: null,
    gegenpartei_ok: null,
    notes: ''
  }));
}

function ensureDailyReviewTemplate(date: string, samplePath: string, nowIso: string): string {
  const reviewPath = path.join(DAILY_DIR, `DAILY_REVIEW_${date}.json`);
  if (fs.existsSync(reviewPath)) {
    const existing = readJsonIfExists<Partial<DailyReview>>(reviewPath) || {};
    const nextReviewer = String(existing.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY;
    if (nextReviewer !== String(existing.reviewer_primary || '')) {
      writeJson(reviewPath, {
        ...existing,
        reviewer_primary: nextReviewer,
        updated_at: nowIso
      });
    }
    return reviewPath;
  }

  const sample = readJsonIfExists<SampleFile>(samplePath);
  const rows = sample?.rows || [];
  const payload: DailyReview = {
    date,
    sample_file: samplePath,
    expected_sample_size: rows.length,
    reviewed_count: 0,
    reviewer_primary: DEFAULT_REVIEWER_PRIMARY,
    critical_mismatches: 0,
    decision: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
    rows: buildReviewRows(rows)
  };
  writeJson(reviewPath, payload);
  return reviewPath;
}

function ensureWeeklyReviewTemplate(week: string, samplePath: string, nowIso: string): string {
  const reviewPath = path.join(WEEKLY_DIR, `WEEKLY_REVIEW_${week}.json`);
  if (fs.existsSync(reviewPath)) {
    const existing = readJsonIfExists<Partial<WeeklyReview>>(reviewPath) || {};
    const nextPrimary = String(existing.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY;
    const nextSecondary = String(existing.reviewer_secondary || '').trim() || DEFAULT_REVIEWER_SECONDARY;
    if (
      nextPrimary !== String(existing.reviewer_primary || '') ||
      nextSecondary !== String(existing.reviewer_secondary || '')
    ) {
      writeJson(reviewPath, {
        ...existing,
        reviewer_primary: nextPrimary,
        reviewer_secondary: nextSecondary,
        updated_at: nowIso
      });
    }
    return reviewPath;
  }

  const sample = readJsonIfExists<SampleFile>(samplePath);
  const rows = sample?.rows || [];
  const payload: WeeklyReview = {
    iso_week: week,
    sample_file: samplePath,
    expected_sample_size: rows.length,
    reviewed_count: 0,
    reviewer_primary: DEFAULT_REVIEWER_PRIMARY,
    reviewer_secondary: DEFAULT_REVIEWER_SECONDARY,
    critical_mismatches: 0,
    decision: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
    rows: buildReviewRows(rows)
  };
  writeJson(reviewPath, payload);
  return reviewPath;
}

function listDatesInclusive(startIso: string, endIso: string): string[] {
  const start = new Date(Date.parse(isoDate(startIso) + 'T00:00:00.000Z'));
  const end = new Date(Date.parse(isoDate(endIso) + 'T00:00:00.000Z'));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() < start.getTime()) {
    return [];
  }

  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor.toISOString()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function listIsoWeeksInclusive(startIso: string, endIso: string): string[] {
  const days = listDatesInclusive(startIso, endIso);
  const weeks = new Set<string>();
  for (const day of days) {
    weeks.add(toIsoWeek(`${day}T00:00:00.000Z`));
  }
  return Array.from(weeks).sort((a, b) => a.localeCompare(b));
}

function isReviewCompleted(
  reviewedCount: number,
  expectedCount: number,
  decision: string,
  criticalMismatches: number
): boolean {
  if (expectedCount <= 0) return false;
  if (reviewedCount < expectedCount) return false;
  if (criticalMismatches > 0) return false;
  const normalized = (decision || '').toLowerCase();
  return normalized === 'approved' || normalized === 'passed' || normalized === 'ok';
}

function summarizeReviews(periodStart: string, nowIso: string): ReviewSummary {
  const expectedDates = listDatesInclusive(periodStart, nowIso);
  const expectedWeeks = listIsoWeeksInclusive(periodStart, nowIso);

  let dailyFilesPresent = 0;
  let dailyCompleted = 0;
  let dailySamplesReviewed = 0;
  let weeklyFilesPresent = 0;
  let weeklyCompleted = 0;
  let weeklySamplesReviewed = 0;
  let criticalMismatches = 0;

  const missingDates: string[] = [];
  const missingWeeks: string[] = [];

  for (const date of expectedDates) {
    const filePath = path.join(DAILY_DIR, `DAILY_REVIEW_${date}.json`);
    if (!fs.existsSync(filePath)) {
      missingDates.push(date);
      continue;
    }

    dailyFilesPresent++;
    const review = readJsonIfExists<Partial<DailyReview>>(filePath) || {};
    const reviewedCount = Number(review.reviewed_count || 0);
    const expectedCount = Number(review.expected_sample_size || 0);
    const decision = String(review.decision || 'pending');
    const reviewCriticalMismatches = Number(review.critical_mismatches || 0);

    dailySamplesReviewed += reviewedCount;
    criticalMismatches += reviewCriticalMismatches;
    if (isReviewCompleted(reviewedCount, expectedCount, decision, reviewCriticalMismatches)) {
      dailyCompleted++;
    }
  }

  for (const week of expectedWeeks) {
    const filePath = path.join(WEEKLY_DIR, `WEEKLY_REVIEW_${week}.json`);
    if (!fs.existsSync(filePath)) {
      missingWeeks.push(week);
      continue;
    }

    weeklyFilesPresent++;
    const review = readJsonIfExists<Partial<WeeklyReview>>(filePath) || {};
    const reviewedCount = Number(review.reviewed_count || 0);
    const expectedCount = Number(review.expected_sample_size || 0);
    const decision = String(review.decision || 'pending');
    const reviewCriticalMismatches = Number(review.critical_mismatches || 0);

    weeklySamplesReviewed += reviewedCount;
    criticalMismatches += reviewCriticalMismatches;
    if (isReviewCompleted(reviewedCount, expectedCount, decision, reviewCriticalMismatches)) {
      weeklyCompleted++;
    }
  }

  return {
    daily: {
      expected: expectedDates.length,
      filesPresent: dailyFilesPresent,
      completed: dailyCompleted,
      samplesReviewed: dailySamplesReviewed,
      missingDates
    },
    weekly: {
      expected: expectedWeeks.length,
      filesPresent: weeklyFilesPresent,
      completed: weeklyCompleted,
      samplesReviewed: weeklySamplesReviewed,
      missingWeeks
    },
    criticalMismatches
  };
}

async function writeSamplingArtifacts(nowIso: string): Promise<{ dailySamplePath: string; weeklySamplePath: string; dailySampleSize: number; weeklySampleSize: number }> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const dailySize = Math.max(1, Number.parseInt(process.env.ASSURANCE_DAILY_SAMPLE_SIZE || '25', 10));
  const weeklySize = Math.max(1, Number.parseInt(process.env.ASSURANCE_WEEKLY_SAMPLE_SIZE || '100', 10));

  const service = new GoogleSheetsService(credentialsPath, spreadsheetId);
  await service.init();
  const belege = await service.getAllBelege();

  const dailySample = selectStratifiedSample(belege, dailySize);
  const weeklySample = selectStratifiedSample(belege, weeklySize);
  const day = isoDate(nowIso);
  const week = toIsoWeek(nowIso);

  const dailySamplePath = path.join(SAMPLE_DIR, `DAILY_SAMPLE_${day}.json`);
  const weeklySamplePath = path.join(SAMPLE_DIR, `WEEKLY_SAMPLE_${week}.json`);

  writeJson(dailySamplePath, {
    generatedAt: nowIso,
    sampleType: 'daily',
    sampleSize: dailySample.length,
    sourceRows: belege.length,
    rows: dailySample
  });

  writeJson(weeklySamplePath, {
    generatedAt: nowIso,
    sampleType: 'weekly',
    sampleSize: weeklySample.length,
    sourceRows: belege.length,
    rows: weeklySample
  });

  return {
    dailySamplePath,
    weeklySamplePath,
    dailySampleSize: dailySample.length,
    weeklySampleSize: weeklySample.length
  };
}

function loadOrCreateWindowState(
  history: AssuranceHistoryEntry[],
  report: FinalAcceptanceReport,
  nowIso: string,
  daysTarget: number,
  definitionFingerprint: { fingerprint: string; files: string[] }
): AssuranceWindowState {
  const resetWindow = process.env.ASSURANCE_RESET_WINDOW === '1';
  const existing = !resetWindow ? readJsonIfExists<AssuranceWindowState>(WINDOW_STATE_PATH) : null;

  if (existing) {
    const scopeChanged =
      JSON.stringify(sortYears(existing.scopeYears || [])) !==
      JSON.stringify(sortYears(report.scopeYears || []));

    const definitionChanged = existing.definitionFingerprint !== definitionFingerprint.fingerprint;
    const failRunIds
```
