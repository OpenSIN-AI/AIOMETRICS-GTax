# Context Fulltext

- source_path: src/orchestrator/post_closure_assurance.ts
- source_sha256: 602fcacbba26b203db126d38d8dc8945259a77f6645deb402a3571101152f917
- chunk: 5/5

```text
th = ensureWeeklyReviewTemplate(week, samples.weeklySamplePath, effectiveNowIso);

  let alertKinds = classifyAlerts(report);
  if (windowState.definitionChanged && !alertKinds.includes('schema')) {
    alertKinds = [...alertKinds, 'schema'];
  }
  if (windowState.scopeChanged && !alertKinds.includes('drive_drift')) {
    alertKinds = [...alertKinds, 'drive_drift'];
  }
  if (!clockConsistencyOk && !alertKinds.includes('schema')) {
    alertKinds = [...alertKinds, 'schema'];
  }

  let incidentPath: string | null = null;
  let blockerPath: string | null = null;
  let incidentBranch: string | null = null;

  const currentEntry: AssuranceHistoryEntry = {
    timestamp: effectiveNowIso,
    reportTimestamp: report.timestamp,
    runId: report.runId,
    done: report.done,
    kpis: report.kpis,
    categories: report.after.categories,
    yearCounters: summarizeYearCounters(report.yearlyGateStatus),
    hardFailReasons: report.hardFailReasons,
    scopeYears: report.scopeYears,
    alertKinds,
    incidentPath
  };

  const historyWithCurrent = [...history, currentEntry].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const metrics = computeWindowMetrics(windowState, historyWithCurrent, effectiveNowIso);

  const isOperationalRed =
    !report.done ||
    metrics.failedRuns > 0 ||
    windowState.definitionChanged ||
    windowState.scopeChanged ||
    !clockConsistencyOk;

  if (metrics.failedRuns > 0 || windowState.definitionChanged || windowState.scopeChanged || !clockConsistencyOk) {
    windowState.status = 'broken';
  }

  if (metrics.passTechnicalWindow && windowState.status === 'active') {
    windowState.status = 'completed';
    windowState.completedAt = effectiveNowIso;
  }
  windowState.updatedAt = effectiveNowIso;
  saveWindowState(windowState);

  if (isOperationalRed) {
    const incident = writeIncidentArtifacts(report, alertKinds);
    incidentPath = incident.jsonPath;
    incidentBranch = incident.incidentBranch;
  }

  if (isOperationalRed && metrics.consecutiveRedRuns >= 2 && incidentBranch) {
    const blocker = writeBlockerArtifacts(report, metrics.consecutiveRedRuns, incidentBranch);
    blockerPath = blocker.jsonPath;
  }

  const reviewSummary = summarizeReviews(windowState.periodStart, effectiveNowIso);

  const blockerActiveInWindow = blockerPath !== null || hasBlockerSince(windowState.periodStart);

  const execSignoff = writeExecSignoff({
    state: windowState,
    nowIso: effectiveNowIso,
    report,
    metrics,
    reviewSummary,
    blockerActive: blockerActiveInWindow,
    clockConsistencyOk
  });

  const weeklyTrend = buildWeeklyTrend(historyWithCurrent, effectiveNowIso);
  const certification = writeFinalCertification({
    nowIso: effectiveNowIso,
    state: windowState,
    report,
    metrics,
    reviewSummary,
    execSignoff,
    alertKinds
  });

  const alertPayload = {
    timestamp: effectiveNowIso,
    runId: report.runId,
    status: isOperationalRed ? 'ALERT' : 'OK',
    clockConsistencyOk,
    alertKinds,
    hardFailReasons: report.hardFailReasons,
    kpis: report.kpis,
    stabilityWindow: {
      daysTarget: metrics.daysTarget,
      periodStart: windowState.periodStart,
      periodStartRunId: windowState.periodStartRunId,
      runs: metrics.runs,
      failedRuns: metrics.failedRuns,
      consecutiveFailedRuns: metrics.consecutiveFailedRuns,
      consecutiveRedRuns: metrics.consecutiveRedRuns,
      coverageHours: Number(metrics.coverageHours.toFixed(2)),
      fullWindowCovered: metrics.fullWindowCovered,
      definitionChanged: windowState.definitionChanged,
      scopeChanged: windowState.scopeChanged,
      clockConsistencyOk,
      status: windowState.status,
      pass: windowState.status === 'completed',
      passWithoutCoverage:
        metrics.failedRuns === 0 &&
        !windowState.definitionChanged &&
        !windowState.scopeChanged &&
        clockConsistencyOk
    },
    operationalClosure: {
      decision: execSignoff.decision,
      decisionReasons: execSignoff.decision_reasons,
      approved: execSignoff.decision === 'approved'
    },
    outputs: {
      finalReport: FINAL_REPORT_PATH,
      dailyKpi: dailyKpiPath,
      weeklyTrend: weeklyTrend.jsonPath,
      dailySample: samples.dailySamplePath,
      weeklySample: samples.weeklySamplePath,
      dailyReview: dailyReviewPath,
      weeklyReview: weeklyReviewPath,
      windowState: WINDOW_STATE_PATH,
      execSignoff: EXEC_SIGNOFF_PATH,
      certification: certification.mdPath,
      certificationJson: certification.jsonPath,
      incident: incidentPath,
      blocker: blockerPath
    }
  };

  writeJson(ALERT_PATH, alertPayload);
  appendHistory(currentEntry);

  console.log(JSON.stringify(alertPayload, null, 2));

  const exitOnAlert = process.env.ASSURANCE_EXIT_ON_ALERT !== '0';
  if (isOperationalRed && exitOnAlert) {
    process.exitCode = 2;
  }
}

withPipelineLock('post_closure_assurance', main).catch((error) => {
  console.error('post_closure_assurance failed:', error);
  process.exit(1);
});

```
