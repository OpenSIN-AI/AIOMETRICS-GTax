# Context Fulltext

- source_path: src/orchestrator/final_acceptance_run.ts
- source_sha256: 73281f86a5de6ee3e6ca56e02f0116e62ddd126953316b30ab7ce2c0c437d0a4
- chunk: 4/5

```text
s://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });

  const sheetsService = new GoogleSheetsService(credentialsPath, spreadsheetId);
  await sheetsService.init();
  const auditSchemaMigration = await sheetsService.ensureCanonicalAuditTable();
  await sheetsService.enforceBestPracticeTabs();

  const initialYearlyTabs = await sheetsService.listYearlyTabs();
  const envYears = parseEnvYears(process.env.CHECK_YEARS);

  const initialDriveIndex = await buildCanonicalDriveIndex(driveApi, {
    sourceFolderId,
    targetFolderId,
    accountingRootFolderId
  });
  const canonicalDriveIndexPath = path.join(process.cwd(), 'docs', `CANONICAL_DRIVE_INDEX_${runId}.json`);
  fs.mkdirSync(path.dirname(canonicalDriveIndexPath), { recursive: true });
  fs.writeFileSync(canonicalDriveIndexPath, JSON.stringify(initialDriveIndex.files, null, 2), 'utf8');

  const scopeYears = resolveScopeYears({
    envYears,
    physicalYears: initialDriveIndex.physicalYears,
    yearlyTabYears: parseYearsFromYearlyTabs(initialYearlyTabs),
    canonicalDriveYears: Array.from(new Set(initialDriveIndex.files.map((f) => f.year).filter((y) => isValidYear(y)))).sort()
  });
  if (scopeYears.length === 0) {
    throw new Error('Scope year resolution failed: no years discovered');
  }

  const baseline = await collectSnapshot(sheetsApi, spreadsheetId);
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        runId,
        scopeYears,
        baseline
      },
      null,
      2
    ),
    'utf8'
  );

  await sheetsService.appendAuditMutations([
    {
      run_id: runId,
      timestamp: new Date().toISOString(),
      action: 'BASELINE',
      target: 'final_acceptance',
      drive_file_id: '',
      before_json: '{}',
      after_json: JSON.stringify({ baseline, scopeYears, canonicalDriveIndexPath }),
      reason: 'BASELINE'
    }
  ]);

  const stageResults: StageResult[] = [];
  const loopHistory: LoopStatus[] = [];

  let qa: QaResult = { total: 0, criticalPassed: 0, accuracy: 0, criticalQaIssues: 0, issues: [] };
  let governance: SheetGovernanceResult = { ok: false, expectedYears: scopeYears, requiredTabs: [], presentTabs: [], findings: [] };
  let mismatchResolutionStats: MismatchResolutionStats = {
    belegeBefore: baseline.records,
    belegeAfter: baseline.records,
    yearlyTabsTouched: 0,
    staleYearTabsDeleted: [],
    actionsTotal: 0,
    actionsByType: {},
    actionsByYear: {}
  };
  let afterSnapshot: Snapshot = baseline;
  let yearlyGateStatus: YearlyGateStatus[] = [];
  let integritySummary: any = {};
  let idempotency = {
    firstRunId: null as string | null,
    secondRunId: null as string | null,
    secondRunMutations: 0,
    pass: false
  };

  let nonImprovingRuns = 0;
  let previousMismatchTotal = Number.MAX_SAFE_INTEGER;
  let canRun = true;

  canRun = await runStage(stageResults, 'build', async () => {
    await runCommand('npm', ['run', 'build']);
  }, canRun);

  for (let loop = 1; loop <= maxLoops; loop++) {
    canRun = await runStage(stageResults, `start_sync#${loop}`, async () => {
      await runOrchestratorScript('main');
    }, canRun);

    canRun = await runStage(stageResults, `soft_audit#${loop}`, async () => {
      await runOrchestratorScript('soft_audit', { AUDIT_LEVEL: 'soft' });
    }, canRun);

    canRun = await runStage(stageResults, `integrity_check#${loop}`, async () => {
      await runOrchestratorScript('check_2023_integrity', { CHECK_YEARS: scopeYears.join(',') });
      integritySummary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json'), 'utf8'));
      yearlyGateStatus = computeYearlyGateStatus(integritySummary);
    }, canRun);

    canRun = await runStage(stageResults, `mismatch_resolve#${loop}`, async () => {
      const canonicalNow = await buildCanonicalDriveIndex(driveApi, {
        sourceFolderId,
        targetFolderId,
        accountingRootFolderId
      });
      fs.writeFileSync(canonicalDriveIndexPath, JSON.stringify(canonicalNow.files, null, 2), 'utf8');
      mismatchResolutionStats = await resolveMismatches({
        runId,
        nowIso: new Date().toISOString(),
        sheetsApi,
        spreadsheetId,
        sheetsService,
        canonicalFiles: canonicalNow.files,
        scopeYears,
        sourceFolderId
      });
    }, canRun);

    canRun = await runStage(stageResults, `quality_check#${loop}`, async () => {
      await runOrchestratorScript('check_2023_integrity', { CHECK_YEARS: scopeYears.join(',') });
      integritySummary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json'), 'utf8'));
      yearlyGateStatus = computeYearlyGateStatus(integritySummary);

      const belege = await sheetsService.getAllBelege();
      qa = runQualityCheck(belege as any[], sampleSize);
      await writeQaCriticalOpen(sheetsApi, spreadsheetId, qa.issues);
      afterSnapshot = await collectSnapshot(sheetsApi, spreadsheetId);
    }, canRun);

    canRun = await runStage(stageResults, `contract_sync_guard#${loop}`, async () => {
      await runOrchestratorScript('contract_sync_guard', { CONTRACT_SCOPE_YEARS: scopeYears.join(',') });
      const contract = readContractSyncReport();
      if (!contract) {
        throw new Error('Missing contract_sync_guard report');
      }
    }, canRun);

    canRun = await runStage(stageResults, `governance_check#${loop}`, async () => {
      governance = await sheetsService.checkSheetGovernance(scopeYears);
      const contract = readContractSyncReport();
      if (contract) {
        governance.dashboardGate = {
          ok: contract.gates.gateC.pass,
          formulaDriftCount: contract.gates.gateC.formulaDriftCount,
          valueDriftCount: contract.gates.gateC.valueDriftCount
        };
      }
    }, canRun);

    canRun = await runStage(stageResults, `idempotency_check#${loop}`, async () => {
      idempotency.firstRunId = await sheetsService.getLatestReconcileRunId();
      const auditBefore = await sheetsService.getAuditMutationCount();
      await runOrchestratorScript('main', { SYNC_ONLY: '1' });
      idempotency.secondRunId = await sheetsService.getLatestReconcileRunId();
      const auditAfter = await sheetsService.getAuditMutationCount();
      idempotency.secondRunMutations = Math.max(0, auditAfter - auditBefore);
      if (idempotency.secondRunId && idempotency.firstRunId && idempotency.secondRunId !== idempotency.firstRunId) {
        try {
          const byRun = await sheetsService.getAuditMutationsByRunId(idempotency.secondRunId);
          if (byRun.length > 0) idempotency.secondRunMutations = byRun.length;
        } catch (error) {
          const fallback = idempotency.secondRunMutations;
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`idempotency_check: getAuditMutationsByRunId failed, fallback to audit delta=${fallback}: ${message}`);
        }
      }
      idempotency.pass = idempotency.secondRunMutations === 0;
    }, canRun);

    const mismatchTotal = yearlyGateStatus.reduce((sum, item) => sum + item.driveOnly + item.sheetOnly + item.duplicateDriveIds, 0);
    const contractSyncReport: ContractSyncReport | null = readContractSyncReport();
    const contractPass = Boolean(
      contractSyncReport?.gates?.gateA?.pass &&
      contractSyncReport?.gates?.gateB?.pass &&
      contractSyncReport?.gates?.gateC?.pass
    );
    const doneCandidate =
      mismatchTotal === 0 &&
      afterSnapshot.forbiddenMarkerHits === 0 &&
      qa.accuracy >= 0.99 &&
      qa.criticalQaIssues === 0 &&
      governance.ok &&
      governance.findings.filter((f) => f.severity === 'CRITICAL').length === 0 &&
      idempotency.pass &&
      contractPass;
    loopHistory.push({ iteration: loop, mismatchTotal, doneCandidate });

    if (doneCandidate || !canRun) {
      break;
    }

    if (mismatchTotal < previousMismatchTotal) {
      nonImprovingRuns = 0;
    } else {
      nonImprovingRuns += 1;
    }
    previousMismatchTotal = mismatchTotal;

    if (nonImprovingRuns >= 2) {
      const fullMismatchFiles = integritySummary?.fullMismatchFiles || {};
      const unresolved: Record<string, string[]> = {};
      for (const [year, refs] of Object.entries<any>(fullMismatchFiles)) {
        const driveOnlyPath = refs?.driveOnlyFullPath;
        if (!driveOnlyPath || !fs.existsSync(driveOnlyPath)) continue;
        const payload = JSON.parse(fs.readFileSync(driveOnlyPath, 'utf8'));
        const ids: string[] = [];
        for (const row of [...(payload.income || []), ...(payload.expense || [])]) {
          if (row?.id) ids.push(String(row.id));
        }
        unresolved[year] = ids.slice(0, 200);
      }
      fs.writeFileSync(unresolvedPath, JSON.stringify({ runId, unresolved }, null, 2), 'utf8');
      break;
    }
  }

  await runStage(stageResults, 'final_report', async () => {
    const contractSyncReport: ContractSyncReport | null = readContractSyncReport();
    const totalDriveOnly = yearlyGateStatus.reduce((sum, item) => sum + item.driveOnly, 0);
    const totalSheetOnly = yearlyGateStatus.reduce((sum, item) => sum + item.sheetOnly, 0);
    const totalDuplicateIds = yearlyGateStatus.reduce((sum, item) => sum + item.duplicateDriveIds, 0);
    const contractGateA = Boolean(contractSyncReport?.gates?.gateA?.pass);
    const contractGateB = Boolean(contractSyncReport?.gates?.gateB?.pass);
    const contractGateC = Boolean(contractSyncReport?.gates?.gateC?.pass);
    const dashboardFormulaDriftCount = Number(contractSyncReport?.gates?.gateC?.formulaDriftCount || 0);
    const dashboardValueDriftCount = Number(contractSyncReport?.gates?.gateC?.valueDriftCount || 0);
    const bidirectionalDriftIncidents = (contractGateA ? 0 : 1) + (contractGateB ? 0 : 1);

    const hardFailReasons: string[] = [];
    for (const stage of stageResults) {
      if (!stage.ok && stage.error !== 'SKIPPED_DUE_TO_PREVIOUS_FAILURE') {
        hardFailReasons.push(`STAGE_FAILED:${stage.stage}`);
      }
    }
    if (totalDriveOnly !== 0) hardFailReasons.push('DRIVE_ONLY_NOT_ZERO');
    if (totalSheetOnly !== 0) hardFailReasons.push('SHEET_ONLY_NOT_ZERO');
    if (totalDuplicateIds !== 0) hardFailReasons.push('DUPLICATE_IDS_NOT_ZERO');
    if (afterSnapshot.forbiddenMarkerHits !== 0) hardFailReasons.push('FORBIDDEN_MARKER_PRESENT');
    if (qa.accuracy < 0.99) hardFailReasons.push('QA_BELOW_THRESHOLD');
    if (qa.criticalQaIssues > 0) hardFailReasons.push('CRITICAL_QA_ISSUES_PRESENT');
    const criticalGovernance = governance.findings.filter((f) => f.severity === 'CRITICAL');
    if (criticalGovernance.length > 0) hardFailReasons.push('GOVERNANCE_CRITICAL_FINDINGS');
    if (!idempotency.pass) hardFailReasons.push('IDEMPOTENCY_FAILED');
    if (!contractSyncReport) hardFailReasons.push('CONTRACT_SYNC_REPORT_MISSING');
    if (!contractGateA || !contractGateB || !contractGateC) hardFailReasons.push('CONTRACT_SYNC_GATE_FAILED');
    if (dashboardFormulaDriftCount > 0) hardFailReasons.push('DASHBOARD_FORMULA_DRIFT');
    if (dashboardValueDriftCount > 0) hardFailReasons.push('DASHBOARD_VALUE_DRIFT');
    if (nonImprovingRuns >= 2 && fs.existsSync(unresolvedPath)) hardFailReasons.push('NO_IMPROVEMENT_ESCALATION');

    const done = hardFailReasons.length === 0;
    const report = {
      timestamp: new Date().toISOString(),
      runId,
      scopeYears,
      years: scopeYears,
      stages: stageResults,
      baseline,
      after: afterSnapshot,
      kpis: {
        totalDriveOnly,
        totalSheetOnly,
        totalDuplicateIds,
        forbiddenMarkerHits: afterSnapshot.forbiddenMarkerHits,
        qaSampleSize: qa.total,
        qaSampleCriticalPassed: qa.criticalPassed,
        qaAccuracy: qa.accuracy,
        criticalQaIssues: qa.critica
```
