# Context Fulltext

- source_path: src/orchestrator/micro_local_118_tesseract_filter.ts
- source_sha256: ddddf5be8c46a1f6196c1589b2aecfe4e47d42b5e80fb594c20d29f6a9d33320
- chunk: 2/2

```text
oeMarkers = ['zoe solar', 'jeremy schulze'];

  for (const localPath of batch) {
    if (Date.now() - runStart >= RUN_BUDGET_MS - 10000) {
      decisions.push({ file: localPath, action: 'skip_unknown', reason: 'run_budget_exhausted' });
      continue;
    }
    try {
      const st = fs.statSync(localPath);
      if (st.size > MAX_FILE_MB * 1024 * 1024) {
        decisions.push({ file: localPath, action: 'skip_unknown', reason: `file_too_large_${(st.size / 1024 / 1024).toFixed(1)}mb` });
        continue;
      }
      const localMd5 = await md5ForFile(localPath);
      if (CHECK_DRIVE_MD5_DUPES && localMd5 && driveMd5Set.has(localMd5)) {
        if (DELETE_DUPLICATES) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_duplicate', reason: `duplicate_by_drive_md5:${localMd5}` });
        continue;
      }
      const textRaw = await withTimeout(tesseractTextForFile(localPath), OCR_TIMEOUT_MS);
      const text = normalize(`${path.basename(localPath)}\n${textRaw}`);
      const invoiceNo = parseInvoiceNo(text);
      const dateToken = [REDACTED]);
      const amountToken = [REDACTED]);
      const isDup = isDuplicateByContent(text, invoiceNo, dateToken, amountToken, existing.rows, existing.invoiceSet);
      const has7 = /\b7\s?%|\b7,0\s?%|erm[aä]ssigt|erm[aä]ßigt/.test(text);
      const has19 = /\b19\s?%|\b19,0\s?%/.test(text);
      const has0 = /\b0\s?%|\b0,0\s?%/.test(text);
      const isPrivate = includesAny(text, privateMarkers);
      const isUnusable = includesAny(text, unusableMarkers);
      const looksIncome = /rechnung|abschlagsrechnung|schlussrechnung|teilrechnung|invoice/.test(text)
        && (/kunde|auftraggeber|leistungsempf[äa]nger/.test(text) || includesAny(text, zoeMarkers));
      const isZoe = includesAny(text, zoeMarkers);

      if (isDup) {
        if (DELETE_DUPLICATES) safeUnlink(localPath);
        decisions.push({ file: [REDACTED]
        continue;
      }
      if (isPrivate) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'private_marker_detected' });
        continue;
      }
      if (isUnusable) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'unusable_marker_detected' });
        continue;
      }
      if (has7) {
        decisions.push({ file: localPath, action: 'skip_tax7', reason: '7_percent_tax_detected' });
        continue;
      }
      if (isZoe && looksIncome && has19) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'zoe_invoice_19_percent' });
        continue;
      }
      if (isZoe && looksIncome && !has0 && (has7 || has19 || /(?:mwst|ust|umsatzsteuer)/.test(text))) {
        if (DELETE_UNUSABLE) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'delete_unusable', reason: 'zoe_invoice_not_0_percent' });
        continue;
      }

      if (UPLOAD_ENABLED) {
        await uploadToDrive(localPath);
        if (localMd5) driveMd5Set.add(localMd5);
        if (DELETE_AFTER_UPLOAD) safeUnlink(localPath);
        decisions.push({ file: localPath, action: 'upload', reason: `uploaded_to_source_drive:${SOURCE_DRIVE_FOLDER_ID}` });
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
