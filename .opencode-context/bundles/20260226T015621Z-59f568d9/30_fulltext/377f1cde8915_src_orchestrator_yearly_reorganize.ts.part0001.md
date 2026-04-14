# Context Fulltext

- source_path: src/orchestrator/yearly_reorganize.ts
- source_sha256: ece63613fb60979fda3e4e24f25aa59c959c36a26e7fcd03ff62b65f3bb218c0
- chunk: 1/2

```text
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
  let pageToken: [REDACTED] | undefined = undefined;
  do {
    const response: any = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: [REDACTED]
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = [REDACTED] || undefined;
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
 
```
