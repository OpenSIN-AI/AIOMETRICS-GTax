# Context Fulltext

- source_path: src/orchestrator/post_closure_assurance.ts
- source_sha256: 602fcacbba26b203db126d38d8dc8945259a77f6645deb402a3571101152f917
- chunk: 4/5

```text
 = Array.from(new Set(existing.failRunIds || []));
    if (!report.done && !failRunIds.includes(report.runId)) {
      failRunIds.push(report.runId);
    }

    const status: WindowStatus = (definitionChanged || scopeChanged || failRunIds.length > 0)
      ? 'broken'
      : existing.status;

    return {
      ...existing,
      daysTarget: existing.daysTarget,
      scopeYears: existing.scopeYears,
      definitionFiles: existing.definitionFiles || definitionFingerprint.files,
      definitionChanged,
      scopeChanged,
      failRunIds,
      status,
      updatedAt: nowIso
    };
  }

  const greenCandidates = history
    .filter((entry) => entry.done)
    .map((entry) => ({ runId: entry.runId, ts: entry.reportTimestamp || entry.timestamp }));

  if (report.done) {
    greenCandidates.push({ runId: report.runId, ts: report.timestamp });
  }

  const latestGreen = greenCandidates.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (!latestGreen) {
    throw new Error('Cannot initialize 7-day window: no green run available');
  }

  const failRunIds: string[] = [];
  if (!report.done) failRunIds.push(report.runId);

  const state: AssuranceWindowState = {
    version: 1,
    daysTarget,
    periodStart: latestGreen.ts,
    periodStartRunId: latestGreen.runId,
    scopeYears: sortYears(report.scopeYears),
    definitionFingerprint: definitionFingerprint.fingerprint,
    definitionFiles: definitionFingerprint.files,
    definitionChanged: false,
    scopeChanged: false,
    status: report.done ? 'active' : 'broken',
    failRunIds,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  return state;
}

function computeWindowMetrics(state: AssuranceWindowState, historyWithCurrent: AssuranceHistoryEntry[], nowIso: string): WindowMetrics {
  const rows = historyWithCurrent
    .filter((entry) => Date.parse(entry.timestamp) >= Date.parse(state.periodStart))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const failedRuns = rows.filter((entry) => entryFailed(entry)).length;

  let consecutiveFailedRuns = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].done) break;
    consecutiveFailedRuns++;
  }

  let consecutiveRedRuns = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!entryOperationalRed(rows[i])) break;
    consecutiveRedRuns++;
  }

  const coverageHours = hoursBetween(state.periodStart, nowIso);
  const fullWindowCovered = coverageHours >= (state.daysTarget * 24);

  const passTechnicalWindow =
    failedRuns === 0 &&
    fullWindowCovered &&
    !state.definitionChanged &&
    !state.scopeChanged;

  return {
    daysTarget: state.daysTarget,
    runs: rows.length,
    failedRuns,
    consecutiveFailedRuns,
    consecutiveRedRuns,
    coverageHours,
    fullWindowCovered,
    passTechnicalWindow
  };
}

function writeExecSignoff(params: {
  state: AssuranceWindowState;
  nowIso: string;
  report: FinalAcceptanceReport;
  metrics: WindowMetrics;
  reviewSummary: ReviewSummary;
  blockerActive: boolean;
  clockConsistencyOk: boolean;
}): ExecSignoff {
  const existing = readJsonIfExists<Partial<ExecSignoff>>(EXEC_SIGNOFF_PATH);

  const reasons: string[] = [];
  if (!params.report.done) reasons.push('latest_run_not_green');
  if (params.metrics.failedRuns > 0) reasons.push('failed_runs_within_window');
  if (!params.metrics.fullWindowCovered) reasons.push('window_not_fully_covered');
  if (params.state.definitionChanged) reasons.push('definition_changed_during_window');
  if (params.state.scopeChanged) reasons.push('scope_years_changed_during_window');
  if (params.reviewSummary.daily.completed < params.reviewSummary.daily.expected) reasons.push('daily_review_incomplete');
  if (params.reviewSummary.weekly.completed < params.reviewSummary.weekly.expected) reasons.push('weekly_review_incomplete');
  if (params.reviewSummary.criticalMismatches > 0) reasons.push('critical_manual_mismatches_present');
  if (params.blockerActive) reasons.push('blocked_after_two_consecutive_failed_runs');
  if (!params.clockConsistencyOk) reasons.push('clock_consistency_violation');

  const decision: 'approved' | 'blocked' = reasons.length === 0 ? 'approved' : 'blocked';

  const payload: ExecSignoff = {
    period_start: params.state.periodStart,
    period_end: params.nowIso,
    reviewer_primary: String(existing?.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY,
    reviewer_secondary: String(existing?.reviewer_secondary || '').trim() || DEFAULT_REVIEWER_SECONDARY,
    daily_samples_reviewed: params.reviewSummary.daily.samplesReviewed,
    weekly_samples_reviewed: params.reviewSummary.weekly.samplesReviewed,
    critical_mismatches: params.reviewSummary.criticalMismatches,
    decision,
    decision_reasons: reasons,
    generated_at: params.nowIso
  };

  writeJson(EXEC_SIGNOFF_PATH, payload);
  return payload;
}

function writeFinalCertification(params: {
  nowIso: string;
  state: AssuranceWindowState;
  report: FinalAcceptanceReport;
  metrics: WindowMetrics;
  reviewSummary: ReviewSummary;
  execSignoff: ExecSignoff;
  alertKinds: AssuranceAlertKind[];
}): { mdPath: string; jsonPath: string } {
  const periodStartDay = isoDate(params.state.periodStart);
  const periodEndDay = isoDate(params.nowIso);
  const baseName = `FINAL_7D_CERTIFICATION_${periodStartDay}_to_${periodEndDay}`;

  const payload = {
    generatedAt: params.nowIso,
    period_start: params.state.periodStart,
    period_end: params.nowIso,
    windowStatus: params.state.status,
    daysTarget: params.state.daysTarget,
    coverageHours: Number(params.metrics.coverageHours.toFixed(2)),
    fullWindowCovered: params.metrics.fullWindowCovered,
    technicalGreenLatestRun: params.report.done,
    latestRunId: params.report.runId,
    latestKpis: params.report.kpis,
    alertKinds: params.alertKinds,
    reviewSummary: params.reviewSummary,
    execSignoff: params.execSignoff,
    operationalClosureApproved: params.execSignoff.decision === 'approved'
  };

  const jsonPath = path.join(ASSURANCE_DIR, `${baseName}.json`);
  const mdPath = path.join(ASSURANCE_DIR, `${baseName}.md`);
  writeJson(jsonPath, payload);
  writeJson(path.join(ASSURANCE_DIR, 'FINAL_7D_CERTIFICATION_LATEST.json'), payload);

  const lines: string[] = [];
  lines.push(`# Final 7-Day Certification (${periodStartDay} -> ${periodEndDay})`);
  lines.push('');
  lines.push(`- generatedAt: ${params.nowIso}`);
  lines.push(`- latestRunId: ${params.report.runId}`);
  lines.push(`- technicalGreenLatestRun: ${params.report.done}`);
  lines.push(`- windowStatus: ${params.state.status}`);
  lines.push(`- daysTarget: ${params.state.daysTarget}`);
  lines.push(`- coverageHours: ${params.metrics.coverageHours.toFixed(2)}`);
  lines.push(`- fullWindowCovered: ${params.metrics.fullWindowCovered}`);
  lines.push(`- execDecision: ${params.execSignoff.decision}`);
  lines.push('');
  lines.push('## KPI');
  lines.push('');
  lines.push(`- driveOnly: ${params.report.kpis.totalDriveOnly}`);
  lines.push(`- sheetOnly: ${params.report.kpis.totalSheetOnly}`);
  lines.push(`- duplicateIds: ${params.report.kpis.totalDuplicateIds}`);
  lines.push(`- forbiddenMarkerHits: ${params.report.kpis.forbiddenMarkerHits}`);
  lines.push(`- qaAccuracy: ${(params.report.kpis.qaAccuracy * 100).toFixed(2)}%`);
  lines.push(`- criticalQaIssues: ${params.report.kpis.criticalQaIssues}`);
  lines.push(`- idempotencyPass: ${params.report.kpis.idempotencyPass}`);
  lines.push(`- dashboardFormulaDriftCount: ${params.report.kpis.dashboardFormulaDriftCount}`);
  lines.push(`- dashboardValueDriftCount: ${params.report.kpis.dashboardValueDriftCount}`);
  lines.push(`- bidirectionalDriftIncidents: ${params.report.kpis.bidirectionalDriftIncidents}`);
  lines.push('');
  lines.push('## Manual QA Coverage');
  lines.push('');
  lines.push(`- daily_expected: ${params.reviewSummary.daily.expected}`);
  lines.push(`- daily_completed: ${params.reviewSummary.daily.completed}`);
  lines.push(`- weekly_expected: ${params.reviewSummary.weekly.expected}`);
  lines.push(`- weekly_completed: ${params.reviewSummary.weekly.completed}`);
  lines.push(`- critical_mismatches: ${params.reviewSummary.criticalMismatches}`);
  lines.push('');
  lines.push('## Exec Decision Reasons');
  lines.push('');
  for (const reason of params.execSignoff.decision_reasons) {
    lines.push(`- ${reason}`);
  }
  if (params.execSignoff.decision_reasons.length === 0) {
    lines.push('- none');
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(ASSURANCE_DIR, 'FINAL_7D_CERTIFICATION_LATEST.md'), `${lines.join('\n')}\n`, 'utf8');

  return { mdPath, jsonPath };
}

function saveWindowState(state: AssuranceWindowState): void {
  writeJson(WINDOW_STATE_PATH, state);
}

function normalizeNowIso(periodStartIso: string, nowIso: string): {
  effectiveNowIso: string;
  clockConsistencyOk: boolean;
} {
  const periodStartMs = Date.parse(periodStartIso);
  const nowMs = Date.parse(nowIso);

  if (!Number.isFinite(periodStartMs) || !Number.isFinite(nowMs)) {
    return {
      effectiveNowIso: nowIso,
      clockConsistencyOk: false
    };
  }

  if (nowMs >= periodStartMs) {
    return {
      effectiveNowIso: nowIso,
      clockConsistencyOk: true
    };
  }

  return {
    effectiveNowIso: periodStartIso,
    clockConsistencyOk: false
  };
}

function hasBlockerSince(periodStartIso: string): boolean {
  if (!fs.existsSync(INCIDENT_DIR)) return false;
  const periodStartMs = Date.parse(periodStartIso);
  const files = fs
    .readdirSync(INCIDENT_DIR)
    .filter((name) => name.startsWith('BLOCKER_') && name.endsWith('.json'));

  for (const name of files) {
    const fullPath = path.join(INCIDENT_DIR, name);
    const payload = readJsonIfExists<{ generatedAt?: string }>(fullPath);
    const generatedAtMs = Date.parse(String(payload?.generatedAt || ''));
    if (Number.isFinite(periodStartMs) && Number.isFinite(generatedAtMs) && generatedAtMs >= periodStartMs) {
      return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  ensureDirStructure();

  const runAcceptance = process.env.ASSURANCE_SKIP_ACCEPTANCE !== '1';
  if (runAcceptance) {
    await runCommand('npm', ['run', 'final-acceptance'], {
      PIPELINE_LOCK_BYPASS: '1',
      ACCEPTANCE_MAX_LOOPS: process.env.ACCEPTANCE_MAX_LOOPS || '3'
    });
  }

  const report = readJsonIfExists<FinalAcceptanceReport>(FINAL_REPORT_PATH);
  if (!report) {
    throw new Error(`Missing final acceptance report: ${FINAL_REPORT_PATH}`);
  }
  report.kpis = normalizeKpis(report.kpis);

  const contractKeys = [
    'done',
    'kpis',
    'scopeYears',
    'yearlyGateStatus',
    'contractSync',
    'criticalQaIssues',
    'governanceFindings',
    'hardFailReasons',
    'idempotency'
  ];
  const rawReport = JSON.parse(fs.readFileSync(FINAL_REPORT_PATH, 'utf8')) as Record<string, unknown>;
  const missingContractKeys = contractKeys.filter((key) => !(key in rawReport));
  if (missingContractKeys.length > 0) {
    throw new Error(`Final report contract violation: missing keys ${missingContractKeys.join(', ')}`);
  }

  const history = parseHistory();
  const definitionFingerprint = computeDefinitionFingerprint();
  const daysTarget = Math.max(1, Number.parseInt(process.env.ASSURANCE_STABILITY_WINDOW_DAYS || '7', 10));
  const nowIso = new Date().toISOString();

  const windowState = loadOrCreateWindowState(history, report, nowIso, daysTarget, definitionFingerprint);
  const normalizedClock = normalizeNowIso(windowState.periodStart, nowIso);
  const effectiveNowIso = normalizedClock.effectiveNowIso;
  const clockConsistencyOk = normalizedClock.clockConsistencyOk;

  const dailyKpiPath = writeDailyKpi(report);
  const samples = await writeSamplingArtifacts(effectiveNowIso);
  const day = isoDate(effectiveNowIso);
  const week = toIsoWeek(effectiveNowIso);
  const dailyReviewPath = ensureDailyReviewTemplate(day, samples.dailySamplePath, effectiveNowIso);
  const weeklyReviewPa
```
