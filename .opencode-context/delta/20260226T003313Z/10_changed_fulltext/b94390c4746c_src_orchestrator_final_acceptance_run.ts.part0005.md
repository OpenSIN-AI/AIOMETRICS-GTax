# Delta Fulltext

- source_path: src/orchestrator/final_acceptance_run.ts
- source_sha256: f0cfb52f2d0978f314e10b545c4c2f23fd4cc15c1768b9df8b29a7dfdb6ca58f
- chunk: 5/5

```text
s,
      qaIssues: qa.issues,
      auditSchemaMigration,
      mismatchResolutionStats,
      hardFailReasons,
      integrity: integritySummary,
      idempotency,
      canonicalDriveIndexPath,
      loopHistory,
      unresolvedIdsPath: fs.existsSync(unresolvedPath) ? unresolvedPath : null,
      done
    };

    fs.mkdirSync(path.dirname(reportMdPath), { recursive: true });
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');

    const md: string[] = [];
    md.push('# Final Acceptance Report');
    md.push('');
    md.push(`- Timestamp: ${report.timestamp}`);
    md.push(`- Run ID: ${runId}`);
    md.push(`- Scope years: ${scopeYears.join(', ')}`);
    md.push(`- Done (all gates green): ${done ? 'YES' : 'NO'}`);
    md.push('');
    md.push('## KPI Summary');
    md.push('');
    md.push(`- records_before: ${baseline.records}`);
    md.push(`- records_after: ${afterSnapshot.records}`);
    md.push(`- driveOnly_total: ${totalDriveOnly}`);
    md.push(`- sheetOnly_total: ${totalSheetOnly}`);
    md.push(`- duplicate_drive_file_id_total: ${totalDuplicateIds}`);
    md.push(`- forbidden_marker_hits: ${afterSnapshot.forbiddenMarkerHits}`);
    md.push(`- qa_accuracy_critical: ${(qa.accuracy * 100).toFixed(2)}% (${qa.criticalPassed}/${qa.total})`);
    md.push(`- critical_qa_issues: ${qa.criticalQaIssues}`);
    md.push(`- idempotency_pass: ${idempotency.pass}`);
    md.push(`- dashboard_formula_drift_count: ${dashboardFormulaDriftCount}`);
    md.push(`- dashboard_value_drift_count: ${dashboardValueDriftCount}`);
    md.push(`- bidirectional_drift_incidents: ${bidirectionalDriftIncidents}`);
    md.push(`- contract_gate_A: ${contractGateA}`);
    md.push(`- contract_gate_B: ${contractGateB}`);
    md.push(`- contract_gate_C: ${contractGateC}`);
    md.push('');
    md.push('## Hard Fail Reasons');
    md.push('');
    for (const reason of hardFailReasons) {
      md.push(`- ${reason}`);
    }
    md.push('');
    md.push('## Yearly Gate Status');
    md.push('');
    for (const yearly of yearlyGateStatus) {
      md.push(`- ${yearly.year}: pass=${yearly.pass} driveOnly=${yearly.driveOnly} sheetOnly=${yearly.sheetOnly} duplicateDriveIds=${yearly.duplicateDriveIds}`);
    }
    md.push('');
    md.push('## Governance Findings (Top 50)');
    md.push('');
    for (const finding of governance.findings.slice(0, 50)) {
      md.push(`- ${finding.severity} | ${finding.tab} | ${finding.code} | ${finding.message}`);
    }
    md.push('');
    md.push('## Stage Results');
    md.push('');
    for (const stage of stageResults) {
      md.push(`- ${stage.stage}: ${stage.ok ? 'OK' : 'FAIL'} (${stage.durationMs}ms)`);
    }
    md.push('');
    md.push('## QA Issues (Top 50)');
    md.push('');
    for (const issue of qa.issues.slice(0, 50)) {
      md.push(`- ${issue.severity} | ${issue.drive_file_id} | ${issue.year} | ${issue.category} | ${issue.failures.join(', ')}`);
    }
    md.push('');
    md.push('## JSON Appendix');
    md.push('');
    md.push('```json');
    md.push(JSON.stringify(report, null, 2));
    md.push('```');

    fs.writeFileSync(reportMdPath, md.join('\n'), 'utf8');
  }, true);

  const finalReport = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
  console.log(JSON.stringify({
    done: finalReport.done,
    runId,
    scopeYears,
    reportMdPath,
    reportJsonPath,
    kpis: finalReport.kpis,
    hardFailReasons: finalReport.hardFailReasons
  }, null, 2));
}

withPipelineLock('final_acceptance', main).catch((error) => {
  console.error('final_acceptance_run failed:', error);
  process.exit(1);
});

```
