import * as dotenv from 'dotenv';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleDriveService } from '../drive/googleDriveService.js';
import { BelegRecord, GoogleSheetsService } from '../db/googleSheetsService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

type Cashflow = 'Einnahmen' | 'Ausgaben';

interface ScanFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  parentId: string;
  path: string;
  md5Checksum: string;
}

interface YearFolders {
  yearFolderId: string;
  incomeFolderId: string;
  expenseFolderId: string;
}

interface DuplicateItem {
  originalId: string;
  duplicateId: string;
  key: string;
  strategy: 'md5' | 'name_size';
}

interface MoveTask {
  file: ScanFile;
  destinationId: string;
  year: number;
  cashflow: Cashflow;
}

const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const ARCHIVE_FOLDER_ID = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const ERROR_FOLDER_ID = '18mTwp4VjJ_9aGeEEgmm_KsdREkzrKnO5';
const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';

const EXCLUDED_PARENT_IDS = new Set<string>([
  DUPLICATE_FOLDER_ID,
  MISSING_FOLDER_ID,
  ARCHIVE_FOLDER_ID,
  ERROR_FOLDER_ID,
  PRIVATE_FOLDER_ID
]);

const INCOME_KEYWORDS = [
  'einnahme',
  'gutschrift',
  'erstattung',
  'rueckerstattung',
  'rückerstattung',
  'umsatz',
  'verkauf',
  'mieteinnahme',
  'income',
  'refund',
  'credit note'
];

const EXPENSE_KEYWORDS = [
  'ausgabe',
  'rechnung',
  'quittung',
  'beleg',
  'kauf',
  'bestellung',
  'zahlung',
  'lastschrift',
  'abbuchung',
  'gebuehr',
  'gebühr',
  'invoice',
  'receipt',
  'expense'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms)
    )
  ]);
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const isRateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!isRateLimited || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = attempt * 2500;
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: any = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,md5Checksum)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function getFileName(driveApi: drive_v3.Drive, fileId: string): Promise<string> {
  const response = await runWithRateLimitRetry(
    () => driveApi.files.get({
      fileId,
      fields: 'id,name',
      supportsAllDrives: true
    }),
    `getFileName.${fileId}`
  );
  return response.data.name || fileId;
}

async function findFolderByName(
  driveApi: drive_v3.Drive,
  parentId: string,
  folderName: string
): Promise<string | null> {
  const escaped = escapeQueryValue(folderName);
  const response = await runWithRateLimitRetry(
    () => driveApi.files.list({
      q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    }),
    `findFolderByName.${parentId}.${folderName}`
  );
  const match = (response.data.files || [])[0];
  return match?.id || null;
}

async function ensureFolder(driveApi: drive_v3.Drive, parentId: string, folderName: string): Promise<string> {
  const existing = await findFolderByName(driveApi, parentId, folderName);
  if (existing) {
    return existing;
  }
  const created = await runWithRateLimitRetry(
    () => driveApi.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id,name',
      supportsAllDrives: true
    }),
    `ensureFolder.create.${folderName}`
  );
  const createdId = created.data.id;
  if (!createdId) {
    throw new Error(`Failed to create folder ${folderName}`);
  }
  return createdId;
}

function parseYearFromDateString(value: string): number | null {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).getUTCFullYear();
}

function uniqueNumbers(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function isValidYear(y: number): boolean {
  const currentYear = new Date().getFullYear();
  return y >= 2000 && y <= currentYear + 1;
}

function extractCandidateYears(text: string): number[] {
  const out: number[] = [];
  const dmyMatches = text.matchAll(/\b[0-3]?\d[.\-/][01]?\d[.\-/](20\d{2})\b/g);
  for (const match of dmyMatches) {
    const y = Number.parseInt(match[1], 10);
    if (isValidYear(y)) out.push(y);
  }

  const ymdMatches = text.matchAll(/\b(20\d{2})[.\-/][01]?\d[.\-/][0-3]?\d\b/g);
  for (const match of ymdMatches) {
    const y = Number.parseInt(match[1], 10);
    if (isValidYear(y)) out.push(y);
  }

  const genericMatches = text.matchAll(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/g);
  for (const match of genericMatches) {
    const y = Number.parseInt(match[1], 10);
    if (isValidYear(y)) out.push(y);
  }
  return out;
}

function nearestYear(target: number, availableYears: number[]): number {
  return [...availableYears].sort((a, b) => {
    const diff = Math.abs(a - target) - Math.abs(b - target);
    if (diff !== 0) return diff;
    return a - b;
  })[0];
}

function detectYear(
  file: ScanFile,
  existing: BelegRecord | undefined,
  availableYears: number[]
): number {
  const fallbackYear = availableYears[availableYears.length - 1];
  const pathCandidates = uniqueNumbers(extractCandidateYears(file.path));
  for (const year of pathCandidates) {
    if (availableYears.includes(year)) {
      return year;
    }
  }

  const rawText = [
    file.name,
    file.path,
    existing?.original_name || '',
    existing?.category || '',
    existing?.extracted_text || '',
    existing?.ocr_text || '',
    existing?.image_description || '',
    existing?.metadata || ''
  ].join(' ');

  const candidates = uniqueNumbers(extractCandidateYears(rawText));
  for (const year of candidates) {
    if (availableYears.includes(year)) {
      return year;
    }
  }

  const fromCreated = parseYearFromDateString(file.createdTime);
  if (fromCreated !== null && availableYears.includes(fromCreated)) {
    return fromCreated;
  }
  const fromModified = parseYearFromDateString(file.modifiedTime);
  if (fromModified !== null && availableYears.includes(fromModified)) {
    return fromModified;
  }

  const nonRangeCandidate = candidates[0] ?? fromCreated ?? fromModified;
  if (nonRangeCandidate !== undefined && nonRangeCandidate !== null) {
    return nearestYear(nonRangeCandidate, availableYears);
  }
  return fallbackYear;
}

function detectCashflow(file: ScanFile, existing: BelegRecord | undefined): Cashflow {
  const content = [
    file.name,
    file.path,
    existing?.category || '',
    existing?.original_name || '',
    existing?.extracted_text || '',
    existing?.ocr_text || '',
    existing?.image_description || ''
  ].join(' ').toLowerCase();

  if (content.includes('/einnahmen_') || content.includes(' einnahmen_')) {
    return 'Einnahmen';
  }
  if (content.includes('/ausgaben_') || content.includes(' ausgaben_')) {
    return 'Ausgaben';
  }

  let incomeScore = 0;
  let expenseScore = 0;

  for (const keyword of INCOME_KEYWORDS) {
    if (content.includes(keyword)) incomeScore++;
  }
  for (const keyword of EXPENSE_KEYWORDS) {
    if (content.includes(keyword)) expenseScore++;
  }

  const existingCategory = (existing?.category || '').toLowerCase();
  if (existingCategory.includes('rechnung') || existingCategory.includes('quittung')) {
    expenseScore += 2;
  }
  if (existingCategory.includes('einnahmen')) {
    incomeScore += 2;
  }

  if (incomeScore > expenseScore) return 'Einnahmen';
  return 'Ausgaben';
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[0-9]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-zA-Zäöüß ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseOriginal(files: ScanFile[]): ScanFile {
  return [...files].sort((a, b) => {
    const aTs = Date.parse(a.createdTime || a.modifiedTime || '');
    const bTs = Date.parse(b.createdTime || b.modifiedTime || '');
    const aVal = Number.isNaN(aTs) ? Number.MAX_SAFE_INTEGER : aTs;
    const bVal = Number.isNaN(bTs) ? Number.MAX_SAFE_INTEGER : bTs;
    if (aVal !== bVal) return aVal - bVal;
    return a.id.localeCompare(b.id);
  })[0];
}

async function scanFilesRecursively(
  driveApi: drive_v3.Drive,
  rootId: string,
  rootLabel: string
): Promise<ScanFile[]> {
  const out: ScanFile[] = [];
  const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: rootLabel }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);

    const children = await listChildren(driveApi, current.id);
    for (const child of children) {
      const childId = child.id || '';
      const childName = child.name || childId;
      if (!childId) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        queue.push({ id: childId, path: `${current.path}/${childName}` });
        continue;
      }
      if ((child.mimeType || '').startsWith('application/vnd.google-apps')) {
        continue;
      }
      out.push({
        id: childId,
        name: childName,
        mimeType: child.mimeType || '',
        size: Number.parseInt(child.size || '0', 10),
        createdTime: child.createdTime || '',
        modifiedTime: child.modifiedTime || '',
        webViewLink: child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
        parentId: child.parents?.[0] || current.id,
        path: `${current.path}/${childName}`,
        md5Checksum: child.md5Checksum || ''
      });
    }
  }

  return out;
}

async function ensureYearStructure(
  driveApi: drive_v3.Drive,
  accountingRootFolderId: string
): Promise<Map<number, YearFolders>> {
  const topChildren = await listChildren(driveApi, accountingRootFolderId);
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
    keyFile: credentialsPath,
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
