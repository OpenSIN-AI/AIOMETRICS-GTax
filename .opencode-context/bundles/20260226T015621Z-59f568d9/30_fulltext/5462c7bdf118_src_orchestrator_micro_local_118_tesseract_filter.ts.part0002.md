# Context Fulltext

- source_path: src/orchestrator/micro_local_118_tesseract_filter.ts
- source_sha256: d1b52e68b2bebdfbf930d6154d4707760364974384064dd98fdf8890041952f8
- chunk: 2/2

```text
ecisions.push({ file: localPath, action: 'upload', reason: `uploaded_to_source_drive:${SOURCE_DRIVE_FOLDER_ID}` });
      } else {
        decisions.push({ file: localPath, action: 'skip_unknown', reason: 'eligible_but_upload_disabled' });
      }
    } catch (e: any) {
      console.error('Error in tesseract filter processing:', e);
      decisions.push({ file: localPath, action: 'skip_error', reason: String(e?.message || e).slice(0, 180) });
    }
  }

  const counts = decisions.reduce<Record<string, number>>((a, d) => {
    a[d.action] = (a[d.action] || 0) + 1;
    return a;
  }, {});

  const lines: string[] = [];
  lines.push('# MICRO Local 118 Tesseract Filter');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Local root: ${LOCAL_ROOT}`);
  lines.push(`- Batch size: ${BATCH_SIZE}`);
  lines.push(`- Run budget ms: ${RUN_BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - runStart}`);
  lines.push(`- Total local files found: ${allFiles.length}`);
  lines.push(`- Cursor start: ${startCursor}`);
  lines.push(`- Cursor next: ${nextCursor}`);
  lines.push(`- Processed now: ${batch.length}`);
  lines.push(`- Counts: ${JSON.stringify(counts)}`);
  lines.push('');
  lines.push('| action | reason | file |');
  lines.push('|---|---|---|');
  for (const d of decisions) lines.push(`| ${d.action} | ${d.reason.replace(/\|/g, '/')} | ${d.file.replace(/\|/g, '/')} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    localRoot: LOCAL_ROOT,
    totalFiles: allFiles.length,
    cursorStart: startCursor,
    cursorNext: nextCursor,
    processed: batch.length,
    runBudgetMs: RUN_BUDGET_MS,
    elapsedMs: Date.now() - runStart,
    counts,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_local_118_tesseract_filter', main).finally(async () => {
  if (ocrWorker) {
    try {
      await ocrWorker.terminate();
    } catch {
      // best effort worker shutdown
    }
  }
  setTimeout(() => process.exit(0), 100);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});

```
