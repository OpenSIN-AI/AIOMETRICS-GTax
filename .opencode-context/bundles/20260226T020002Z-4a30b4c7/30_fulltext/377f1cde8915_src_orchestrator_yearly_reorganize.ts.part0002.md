# Context Fulltext

- source_path: src/orchestrator/yearly_reorganize.ts
- source_sha256: ece63613fb60979fda3e4e24f25aa59c959c36a26e7fcd03ff62b65f3bb218c0
- chunk: 2/2

```text
 const yearFolders = topChildren
    .filter((entry) => entry.mimeType === 'application/vnd.google-apps.folder')
    .filter((entry) => /^20\d{2}$/.test(entry.name || ''));

  const map = new Map<number, YearFolders>();
  for (const folder of yearFolders) {
    const year = Number.parseInt(folder.name || '', 10);
    if (!Number.isFinite(year)) continue;
    const yearFolderId = folder.id || '';
    if (!yearFolderId) continue;

    const incomeFolderId = await ensureFolder(driveApi, yearFolderId, `Einnahmen_${year}`);
    const expenseFolderId = await ensureFolder(driveApi, yearFolderId, `Ausgaben_${year}`);
    map.set(year, {
      yearFolderId,
      incomeFolderId,
      expenseFolderId
    });
  }

  if (map.size === 0) {
    const currentYear = new Date().getUTCFullYear();
    const yearFolderId = await ensureFolder(driveApi, accountingRootFolderId, `${currentYear}`);
    const incomeFolderId = await ensureFolder(driveApi, yearFolderId, `Einnahmen_${currentYear}`);
    const expenseFolderId = await ensureFolder(driveApi, yearFolderId, `Ausgaben_${currentYear}`);
    map.set(currentYear, {
      yearFolderId,
      incomeFolderId,
      expenseFolderId
    });
  }

  return map;
}

async function collectScanRoots(
  driveApi: drive_v3.Drive,
  accountingRootFolderId: string,
  sourceFolderId: string,
  targetFolderId: string,
  yearMap: Map<number, YearFolders>
): Promise<Array<{ id: string; label: string }>> {
  const roots = new Map<string, string>();
  const add = async (folderId: string): Promise<void> => {
    if (!folderId || roots.has(folderId)) return;
    const label = await getFileName(driveApi, folderId);
    roots.set(folderId, label);
  };

  await add(sourceFolderId);
  await add(targetFolderId);

  for (const yearFolders of yearMap.values()) {
    await add(yearFolders.yearFolderId);
  }

  const topChildren = await listChildren(driveApi, accountingRootFolderId);
  for (const entry of topChildren) {
    if (entry.mimeType !== 'application/vnd.google-apps.folder') continue;
    if (entry.name === 'Sonstige_Belege') {
      await add(entry.id || '');
    }
  }

  return Array.from(roots.entries()).map(([id, label]) => ({ id, label }));
}

async function moveWithRetry(driveService: GoogleDriveService, fileId: string, folderId: string): Promise<void> {
  await runWithRateLimitRetry(
    async () => {
      await withTimeout(
        driveService.moveFile(fileId, folderId),
        45000,
        `moveFile.${fileId}.${folderId}`
      );
    },
    `moveFile.${fileId}.${folderId}`
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners: Array<Promise<void>> = [];
  for (let i = 0; i < limit; i++) {
    runners.push((async () => {
      while (true) {
        const currentIndex = cursor++;
        if (currentIndex >= items.length) {
          break;
        }
        await worker(items[currentIndex], currentIndex);
      }
    })());
  }
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const sourceFolderId = mustEnv('SOURCE_DRIVE_FOLDER_ID');
  const targetFolderId = mustEnv('TARGET_DRIVE_FOLDER_ID');
  const accountingRootFolderId = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  const driveApi = google.drive({ version: 'v3', auth });
  const driveService = new GoogleDriveService(credentialsPath);
  const sheetsService = new GoogleSheetsService(credentialsPath, spreadsheetId);
  await sheetsService.init();

  console.log('Loading existing sheet records...');
  const sheetRecords = await sheetsService.getAllBelege();
  const sheetByDriveId = new Map<string, BelegRecord>();
  for (const record of sheetRecords) {
    sheetByDriveId.set(record.drive_file_id, record);
  }
  console.log(`Existing sheet records: ${sheetRecords.length}`);

  console.log('Ensuring year folder structure...');
  const yearMap = await ensureYearStructure(driveApi, accountingRootFolderId);
  const availableYears = Array.from(yearMap.keys()).sort((a, b) => a - b);
  const yearFlowFolderIds = new Set<string>();
  for (const value of yearMap.values()) {
    yearFlowFolderIds.add(value.incomeFolderId);
    yearFlowFolderIds.add(value.expenseFolderId);
  }
  console.log(`Detected/ensured years: ${availableYears.join(', ')}`);

  console.log('Collecting scan roots...');
  const scanRoots = await collectScanRoots(
    driveApi,
    accountingRootFolderId,
    sourceFolderId,
    targetFolderId,
    yearMap
  );
  console.log(`Scan roots: ${scanRoots.map((r) => `${r.label}(${r.id})`).join(' | ')}`);

  console.log('Scanning files recursively...');
  const fileById = new Map<string, ScanFile>();
  for (const root of scanRoots) {
    const files = await scanFilesRecursively(driveApi, root.id, root.label);
    for (const file of files) {
      if (!fileById.has(file.id)) {
        fileById.set(file.id, file);
      }
    }
    console.log(`Scanned ${root.label}: ${files.length} files`);
  }

  const allFiles = Array.from(fileById.values());
  console.log(`Unique files across roots: ${allFiles.length}`);

  const activeFiles = allFiles.filter((file) => !EXCLUDED_PARENT_IDS.has(file.parentId));
  console.log(`Active files (excluded archive/dupe/missing/error/private): ${activeFiles.length}`);
  const filesToClassify = activeFiles.filter((file) => !yearFlowFolderIds.has(file.parentId));
  console.log(`Files requiring (re)classification (not already in year flow folders): ${filesToClassify.length}`);

  console.log('Detecting hard duplicates...');
  const byMd5 = new Map<string, ScanFile[]>();
  const byNameSize = new Map<string, ScanFile[]>();
  for (const file of activeFiles) {
    if (file.md5Checksum) {
      const key = `md5:${file.md5Checksum}`;
      const list = byMd5.get(key) || [];
      list.push(file);
      byMd5.set(key, list);
    } else if (file.size > 0) {
      const key = `name_size:${normalizeName(file.name)}|${file.size}`;
      const list = byNameSize.get(key) || [];
      list.push(file);
      byNameSize.set(key, list);
    }
  }

  const duplicateItems: DuplicateItem[] = [];
  const duplicateIds = new Set<string>();

  for (const [key, group] of byMd5.entries()) {
    if (group.length < 2) continue;
    const original = chooseOriginal(group);
    for (const candidate of group) {
      if (candidate.id === original.id) continue;
      duplicateItems.push({
        originalId: original.id,
        duplicateId: candidate.id,
        key,
        strategy: 'md5'
      });
      duplicateIds.add(candidate.id);
    }
  }

  for (const [key, group] of byNameSize.entries()) {
    if (group.length < 2) continue;
    const alreadyHandled = group.some((item) => duplicateIds.has(item.id));
    if (alreadyHandled) continue;
    const original = chooseOriginal(group);
    for (const candidate of group) {
      if (candidate.id === original.id) continue;
      duplicateItems.push({
        originalId: original.id,
        duplicateId: candidate.id,
        key,
        strategy: 'name_size'
      });
      duplicateIds.add(candidate.id);
    }
  }

  const duplicateMoveTasks = duplicateItems.filter((item) => {
    const duplicateFile = fileById.get(item.duplicateId);
    if (!duplicateFile) return false;
    return duplicateFile.parentId !== DUPLICATE_FOLDER_ID;
  });

  let movedDuplicates = 0;
  let duplicateProgress = 0;
  await runWithConcurrency(duplicateMoveTasks, 6, async (item) => {
    try {
      await moveWithRetry(driveService, item.duplicateId, DUPLICATE_FOLDER_ID);
      movedDuplicates++;
    } catch (error) {
      console.warn(`Failed duplicate move ${item.duplicateId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      duplicateProgress++;
      if (duplicateProgress % 100 === 0 || duplicateProgress === duplicateMoveTasks.length) {
        console.log(`Duplicate move progress: ${duplicateProgress}/${duplicateMoveTasks.length}`);
      }
    }
  });
  console.log(`Detected duplicates: ${duplicateItems.length}, moved: ${movedDuplicates}`);

  console.log('Classifying and moving files into yearly Einnahmen/Ausgaben folders...');
  const moveTasks: MoveTask[] = [];
  let alreadyCorrect = 0;
  for (const file of filesToClassify) {
    if (duplicateIds.has(file.id)) {
      continue;
    }
    if (EXCLUDED_PARENT_IDS.has(file.parentId)) {
      continue;
    }
    const existing = sheetByDriveId.get(file.id);
    const year = detectYear(file, existing, availableYears);
    const cashflow = detectCashflow(file, existing);
    const folders = yearMap.get(year);
    if (!folders) {
      continue;
    }
    const destinationId = cashflow === 'Einnahmen' ? folders.incomeFolderId : folders.expenseFolderId;
    if (file.parentId === destinationId) {
      alreadyCorrect++;
      continue;
    }
    moveTasks.push({ file, destinationId, year, cashflow });
  }

  let movedByYearFlow = 0;
  let moveProgress = 0;
  const movedPreview: Array<{ id: string; from: string; to: string; year: number; flow: Cashflow; name: string }> = [];
  await runWithConcurrency(moveTasks, 6, async (task) => {
    try {
      await moveWithRetry(driveService, task.file.id, task.destinationId);
      movedByYearFlow++;
      if (movedPreview.length < 20) {
        movedPreview.push({
          id: task.file.id,
          from: task.file.parentId,
          to: task.destinationId,
          year: task.year,
          flow: task.cashflow,
          name: task.file.name
        });
      }
    } catch (error) {
      console.warn(`Failed move ${task.file.id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      moveProgress++;
      if (moveProgress % 100 === 0 || moveProgress === moveTasks.length) {
        console.log(`Move progress: ${moveProgress}/${moveTasks.length}`);
      }
    }
  });

  console.log(JSON.stringify({
    availableYears,
    scannedRoots: scanRoots.length,
    scannedFiles: allFiles.length,
    activeFiles: activeFiles.length,
    filesToClassify: filesToClassify.length,
    moveTasks: moveTasks.length,
    duplicateDetected: duplicateItems.length,
    duplicateMoved: movedDuplicates,
    movedIntoYearFlow: movedByYearFlow,
    alreadyCorrect,
    movedPreview
  }, null, 2));
}

withPipelineLock('yearly_reorganize', main).catch((error) => {
  console.error('yearly_reorganize failed:', error);
  process.exit(1);
});

```
