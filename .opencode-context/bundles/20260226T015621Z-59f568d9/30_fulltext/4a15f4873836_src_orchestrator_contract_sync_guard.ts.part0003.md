# Context Fulltext

- source_path: src/orchestrator/contract_sync_guard.ts
- source_sha256: a97ab7615825395a7d4eaad5c2d0bcc98b3863f49949d1585a9322c52a79f6f2
- chunk: 3/3

```text
 gateBSheetOnly,
    totalDuplicateDriveIds: gateBDuplicate
  };

  const gateC = await evaluateDashboardGate();

  const violations: ContractMismatch[] = [];
  if (!gateA.pass) {
    violations.push({
      gate: 'A',
      code: 'BELEGE_DRIVE_DRIFT',
      severity: 'CRITICAL',
      message: 'belege tab is not in strict sync with Drive IDs',
      detail: `driveOnly=${gateA.driveOnly}, sheetOnly=${gateA.sheetOnly}, duplicateDriveIds=${gateA.duplicateDriveIds}`
    });
  }
  if (!gateB.pass) {
    violations.push({
      gate: 'B',
      code: 'YEARLY_TAB_DRIFT',
      severity: 'CRITICAL',
      message: 'Yearly tabs are not in strict sync with Drive',
      detail: `driveOnly=${gateB.totalDriveOnly}, sheetOnly=${gateB.totalSheetOnly}, duplicateDriveIds=${gateB.totalDuplicateDriveIds}, missingYears=${gateB.missingYears.join(',') || '-'}`
    });
  }
  if (!gateC.pass) {
    violations.push({
      gate: 'C',
      code: 'DASHBOARD_DRIFT',
      severity: 'CRITICAL',
      message: 'Dashboard formula or KPI value drift detected',
      detail: `formulaDriftCount=${gateC.formulaDriftCount}, valueDriftCount=${gateC.valueDriftCount}`
    });
  }

  const report: SyncContractResult = {
    version: '2026.1',
    timestamp: new Date().toISOString(),
    scopeYears,
    gates: {
      gateA,
      gateB,
      gateC
    },
    violations,
    autofixActions: [],
    status: violations.length === 0 ? 'green' : 'red'
  };

  writeReports(report);

  console.log(JSON.stringify({
    status: report.status,
    reportJsonPath: REPORT_JSON_PATH,
    reportMdPath: REPORT_MD_PATH,
    gateA: report.gates.gateA,
    gateB: {
      pass: report.gates.gateB.pass,
      totalDriveOnly: report.gates.gateB.totalDriveOnly,
      totalSheetOnly: report.gates.gateB.totalSheetOnly,
      totalDuplicateDriveIds: report.gates.gateB.totalDuplicateDriveIds
    },
    gateC: {
      pass: report.gates.gateC.pass,
      formulaDriftCount: report.gates.gateC.formulaDriftCount,
      valueDriftCount: report.gates.gateC.valueDriftCount
    }
  }, null, 2));

  if (report.status !== 'green') {
    process.exitCode = 2;
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isMain) {
  main().catch((error) => {
    console.error('contract_sync_guard failed:', error);
    process.exit(1);
  });
}

```
