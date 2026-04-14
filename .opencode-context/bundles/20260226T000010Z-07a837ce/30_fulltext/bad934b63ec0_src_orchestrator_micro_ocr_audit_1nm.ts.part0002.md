# Context Fulltext

- source_path: src/orchestrator/micro_ocr_audit_1nm.ts
- source_sha256: fa6b28836e3288d561a5e9168767e143916ee25ebcecb7dd336b66bfe6fb63de
- chunk: 2/2

```text
`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Model timeout ms: ${MODEL_TIMEOUT_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Candidates (no text): ${candidates.length}`);
  lines.push(`- Skipped due budget: ${skippedBudget}`);
  lines.push(`- OCR text updates in sheet: ${updates.length}`);
  lines.push(`- Moved to private: ${moved.length}`);
  lines.push(`- Kept: ${kept.length}`);
  lines.push('');
  lines.push('## Moved');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const m of moved) lines.push(`| ${m.id} | ${m.reason} | ${m.name} |`);
  lines.push('');
  lines.push('## Kept');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const k of kept) lines.push(`| ${k.id} | ${k.reason} | ${k.name} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    sourceFolderId: SOURCE_FOLDER_ID,
    batchSize: BATCH_SIZE,
    runBudgetMs: RUN_BUDGET_MS,
    modelTimeoutMs: MODEL_TIMEOUT_MS,
    elapsedMs: Date.now() - runStart,
    candidates: candidates.length,
    skippedBudget,
    sheetTextUpdates: updates.length,
    movedToPrivate: moved.length,
    kept: kept.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_ocr_audit_1nm', main).finally(async () => {
  if (tesseractWorker) {
    try {
      await tesseractWorker.terminate();
    } catch {
      // best effort worker shutdown
    }
  }
}).catch((e) => {
  console.error(e);
  process.exit(1);
});

```
