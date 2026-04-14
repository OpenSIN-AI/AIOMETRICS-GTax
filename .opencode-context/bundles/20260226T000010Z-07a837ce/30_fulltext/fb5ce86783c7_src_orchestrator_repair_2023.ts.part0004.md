# Context Fulltext

- source_path: src/orchestrator/repair_2023.ts
- source_sha256: 0f706c6982ec4756cf54653e720a13104fae58266c0636c9ab698f61fe4114e9
- chunk: 4/5

```text
wName = `${flow}_${year}`;
    const flowFolder = await findFolderByName(driveApi, yearNode.id, flowName);
    flowFolderCache.set(key, flowFolder);
    return flowFolder;
  };

  const dbRows = await readTableRows(sheetsApi, spreadsheetId, 'Buchhaltung_DB');
  const dbByDriveId = new Map<string, DbRow>();
  for (const row of dbRows) {
    const id = row.drive_file_id || '';
    if (id && !dbByDriveId.has(id)) dbByDriveId.set(id, row);
  }
  const belegRows = await readTableRows(sheetsApi, spreadsheetId, 'belege');
  const belegeByDriveId = new Map<string, BelegeRow>();
  for (const row of belegRows) {
    const id = row.drive_file_id || '';
    if (id && !belegeByDriveId.has(id)) belegeByDriveId.set(id, row);
  }

  let movedPrivate = 0;
  let movedArchive = 0;
  let movedMissing = 0;
  let movedDuplicate = 0;
  let movedFlow = 0;
  let movedYear = 0;
  let movedPaymentProofMissing = 0;
  let stageMoveCounter = 0;
  let restoredIncomeFromArchive = 0;
  const rebuildStats: Array<{ tab: string; rowCount: number }> = [];
  let incomeInvoiceCount = 0;
  const incomeInvoiceNos = new Set<string>();
  const incomeAmounts = new Set<string>();
  let stageCapReached = false;

  const canMoveMore = (): boolean => {
    if (!Number.isFinite(STAGE_MAX_MOVES) || STAGE_MAX_MOVES <= 0) return true;
    return stageMoveCounter < STAGE_MAX_MOVES;
  };
  const registerMove = (): void => {
    stageMoveCounter++;
    if (!canMoveMore()) {
      stageCapReached = true;
    }
  };

  // Recover likely 2023 income invoices that may have been archived in previous corrective runs.
  if (STAGE_RESTORE_ARCHIVE) {
    const archiveFiles = await listFilesRecursive(driveApi, ARCHIVE_FOLDER_ID, 'Archiviert');
    for (const file of archiveFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const dateProbe = `${db?.belegdatum || ''} ${file.name}`;
      const is2023 = dateProbe.includes(TARGET_YEAR);
      if (!is2023) continue;
      const desired = desiredFlowFromSignals(file, db, beleg, 'Ausgaben');
      if (desired !== 'Einnahmen') continue;
      await moveFile(driveApi, file.id, incomeFolder.id);
      restoredIncomeFromArchive++;
      registerMove();
    }
  }

  const folderSpecs: Array<{ flow: Flow; folder: FolderNode; tab: string }> = [
    { flow: 'Ausgaben', folder: expenseFolder, tab: expenseFolderName },
    { flow: 'Einnahmen', folder: incomeFolder, tab: incomeFolderName }
  ];

  for (const spec of folderSpecs) {
    if (!canMoveMore()) break;
    const initialFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);

    if (STAGE_DEDUPE) {
      const byMd5 = new Map<string, DriveFile[]>();
      const byNameSize = new Map<string, DriveFile[]>();
      for (const file of initialFiles) {
        if (file.md5Checksum) {
          const key = `md5:${file.md5Checksum}`;
          const group = byMd5.get(key) || [];
          group.push(file);
          byMd5.set(key, group);
        } else if (file.size > 0) {
          const key = `name_size:${normalizeName(file.name)}|${file.size}`;
          const group = byNameSize.get(key) || [];
          group.push(file);
          byNameSize.set(key, group);
        }
      }

      const duplicatesToMove = new Set<string>();
      for (const group of byMd5.values()) {
        if (group.length < 2) continue;
        const original = chooseOriginal(group);
        for (const file of group) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }
      for (const group of byNameSize.values()) {
        if (group.length < 2) continue;
        const unresolved = group.filter((f) => !duplicatesToMove.has(f.id));
        if (unresolved.length < 2) continue;
        const original = chooseOriginal(unresolved);
        for (const file of unresolved) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }

      const byBusinessKey = new Map<string, DriveFile[]>();
      for (const file of initialFiles) {
        const key = toBusinessKey(dbByDriveId.get(file.id));
        if (!key) continue;
        const group = byBusinessKey.get(key) || [];
        group.push(file);
        byBusinessKey.set(key, group);
      }
      for (const group of byBusinessKey.values()) {
        const unresolved = group.filter((f) => !duplicatesToMove.has(f.id));
        if (unresolved.length < 2) continue;
        const original = chooseOriginal(unresolved);
        for (const file of unresolved) {
          if (file.id !== original.id) duplicatesToMove.add(file.id);
        }
      }

      // Content-based duplicate detection (OCR/Text + business facts), not name-only.
      const unresolvedDocs = initialFiles
        .filter((f) => !duplicatesToMove.has(f.id))
        .map((f) => buildContentDoc(f, dbByDriveId.get(f.id), belegeByDriveId.get(f.id)));
      const blocks = new Map<string, ContentDoc[]>();
      for (const doc of unresolvedDocs) {
        if (doc.gross > 0 && doc.date) {
          const k = `amount_date:${doc.gross.toFixed(2)}|${doc.date}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
        if (doc.invoiceNo && doc.gross > 0) {
          const k = `invoice_amount:${doc.invoiceNo}|${doc.gross.toFixed(2)}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
        if (doc.supplier && doc.gross > 0 && doc.date) {
          const k = `supplier_amount_date:${doc.supplier}|${doc.gross.toFixed(2)}|${doc.date}`;
          const arr = blocks.get(k) || [];
          arr.push(doc);
          blocks.set(k, arr);
        }
      }

      for (const group of blocks.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort((a, b) => toTimestamp(a.file) - toTimestamp(b.file));
        const originals: ContentDoc[] = [];
        for (const candidate of sorted) {
          if (duplicatesToMove.has(candidate.file.id)) continue;
          let isDup = false;
          for (const original of originals) {
            if (isContentDuplicate(original, candidate)) {
              isDup = true;
              break;
            }
          }
          if (isDup) {
            duplicatesToMove.add(candidate.file.id);
          } else {
            originals.push(candidate);
          }
        }
      }

      for (const fileId of duplicatesToMove) {
        if (!canMoveMore()) break;
        await moveFile(driveApi, fileId, DUPLICATE_FOLDER_ID);
        movedDuplicate++;
        registerMove();
      }
    }

    const afterDuplicateFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);
    if (STAGE_MOVE_POLICY || STAGE_MOVE_FLOW || STAGE_MOVE_YEAR) {
      for (const file of afterDuplicateFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const desiredFlow = desiredFlowFromSignals(file, db, beleg, spec.flow);
      const docYear = inferDocumentYear(file, db, beleg);

      if (STAGE_MOVE_YEAR && docYear && docYear !== TARGET_YEAR) {
        const destinationFlow = desiredFlow;
        const targetFolder = await getFlowFolderForYear(docYear, destinationFlow);
        if (targetFolder) {
          await moveFile(driveApi, file.id, targetFolder.id);
          movedYear++;
          registerMove();
          continue;
        }
      }

      if (spec.flow === 'Ausgaben') {
        if (STAGE_MOVE_FLOW && desiredFlow === 'Einnahmen') {
          await moveFile(driveApi, file.id, incomeFolder.id);
          movedFlow++;
          registerMove();
          continue;
        }

        if (STAGE_MOVE_POLICY) {
          const decision = classifyExpenseAction(file, db, beleg);
          if (decision.action === 'keep') {
            continue;
          }

          const destination = decision.action === 'private'
            ? PRIVATE_FOLDER_ID
            : decision.action === 'archive'
              ? ARCHIVE_FOLDER_ID
              : MISSING_FOLDER_ID;
          await moveFile(driveApi, file.id, destination);
          if (decision.action === 'private') movedPrivate++;
          if (decision.action === 'archive') movedArchive++;
          if (decision.action === 'missing') movedMissing++;
          registerMove();
        }
        continue;
      }
      if (STAGE_MOVE_FLOW && desiredFlow === 'Ausgaben') {
        if (shouldMoveIncomeToExpense(file, db, beleg)) {
          await moveFile(driveApi, file.id, expenseFolder.id);
          movedFlow++;
          registerMove();
          continue;
        }
      }

      if (STAGE_MOVE_POLICY) {
        const decision = classifyIncomeAction(file, db, beleg);
        if (decision.action === 'keep') {
          continue;
        }
        const destination = decision.action === 'private'
          ? PRIVATE_FOLDER_ID
          : decision.action === 'archive'
            ? ARCHIVE_FOLDER_ID
            : MISSING_FOLDER_ID;
        await moveFile(driveApi, file.id, destination);
        if (decision.action === 'private') movedPrivate++;
        if (decision.action === 'archive') movedArchive++;
        if (decision.action === 'missing') movedMissing++;
        registerMove();
        continue;
      }
    }
    }

    if (!STAGE_REBUILD) continue;

    const finalFiles = await listFilesRecursive(driveApi, spec.folder.id, `${TARGET_YEAR}/${spec.folder.name}`);
    finalFiles.sort((a, b) => a.name.localeCompare(b.name));

    const rows: string[][] = [];
    for (const file of finalFiles) {
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      if (db) {
        rows.push(dbRowToYearlyRow(db, beleg, file, file.name, spec.flow));
      } else {
        rows.push(fallbackYearlyRow(file, beleg, spec.flow));
      }

      if (spec.flow === 'Einnahmen') {
        const d = dbByDriveId.get(file.id);
        const no = (d?.belegnr || '').trim().toLowerCase();
        const gross = parseAmount(d?.brutto_gesamt || '');
        if (no) incomeInvoiceNos.add(no);
        if (gross > 0) incomeAmounts.add(gross.toFixed(2));
        if (d?.belegart?.toLowerCase().includes('einnahme')) {
          incomeInvoiceCount++;
        }
      }
    }

    await writeYearSheet(sheetsApi, spreadsheetId, spec.tab, rows);
    rebuildStats.push({ tab: spec.tab, rowCount: rows.length });
  }

  if (STAGE_PAYMENT_PROOF) try {
    const paymentProofFiles = await listFilesRecursive(driveApi, PAYMENT_PROOF_FOLDER_ID, `payment_proofs_${TARGET_YEAR}`);
    for (const file of paymentProofFiles) {
      if (!canMoveMore()) break;
      const db = dbByDriveId.get(file.id);
      const beleg = belegeByDriveId.get(file.id);
      const signals = [
        file.name,
        db?.belegnr || '',
        db?.brutto_gesamt || '',
        db?.lieferant || '',
        beleg?.original_name || '',
        beleg?.ocr_text || '',
        beleg?.extracted_text || ''
      ];
      const probe = normalizeProbe(signals);
      const normalizedProbe = normalizeInvoiceToken(probe);

      let matched = false;
      for (const invoiceNo of incomeInvoiceNos) {
        if (!invoiceNo) continue;
        const token = [REDACTED]);
        if (token.length >= 4 && normalizedProbe.includes(token)) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        const amountTokens = extractAmountTokens(probe);
        matched = amountTokens.some((amount) => incomeAmounts.has(amount));
      }

      if (!matched) {
        await moveFile(driveApi, file.id, MISSING_FOLDER_ID);
        movedPaymentProofMissing++;
        registerMove();
      }
    }
  } catch (error: any) {
    const status = error?.response?.status || error?.code;
    if (status !== 404) throw error;
  }

  console.log(JSON.stringify({
    status: 'ok',
    year: TARGET_YEAR,
    movedPrivate,
  
```
