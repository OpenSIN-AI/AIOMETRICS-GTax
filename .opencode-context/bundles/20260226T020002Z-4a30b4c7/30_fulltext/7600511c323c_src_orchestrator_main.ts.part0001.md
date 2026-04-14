# Context Fulltext

- source_path: src/orchestrator/main.ts
- source_sha256: 3110a841cedd0bba4e2fd3f980d85d4fc0b99412c60d15e39c06d46c9ef2d3de
- chunk: 1/2

```text
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { DriveFile, GoogleDriveService } from '../drive/googleDriveService.js';
import { AuditMutationRecord, BelegRecord, GoogleSheetsService } from '../db/googleSheetsService.js';
import { NvidiaAIClient } from '../ai/nvidiaAIClient.js';
import { FileRouter } from '../routing/fileRouter.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Config {
  googleCredentialsPath: [REDACTED]
  spreadsheetId: string;
  nvidiaApiKey: [REDACTED];
  sourceDriveFolderId: string;
  targetDriveFolderId: string;
  accountingRootFolderId: string;
  syncOnly: boolean;
}

type ReconcileReason =
  | 'MISSING_IN_SHEET'
  | 'ORPHAN_IN_SHEET'
  | 'DUPLICATE_DRIVE_ID'
  | 'YEAR_MISMATCH'
  | 'CATEGORY_MISMATCH'
  | 'QUALITY_FAIL';

type ReconcileScopeYear = string;

type ReconcileActionType =
  | 'DELETE_DUPLICATE'
  | 'DELETE_ORPHAN'
  | 'DELETE_YEARLY_ORPHAN'
  | 'INSERT_MISSING'
  | 'INSERT_YEARLY_MISSING'
  | 'UPDATE_YEAR'
  | 'UPDATE_CATEGORY';

interface ReconcileAction {
  type: ReconcileActionType;
  reason: ReconcileReason;
  target: 'belege' | 'yearly_tabs';
  driveFileId: string;
  scopeYear: ReconcileScopeYear;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  sortKey: string;
}

const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';

async function loadConfig(): Promise<Config> {
  return {
    googleCredentialsPath: [REDACTED]
    spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
    nvidiaApiKey: [REDACTED] || '',
    sourceDriveFolderId: process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH',
    targetDriveFolderId: process.env.TARGET_DRIVE_FOLDER_ID || '11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m',
    accountingRootFolderId: process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p',
    syncOnly: ['1', 'true', 'yes'].includes((process.env.SYNC_ONLY || '').toLowerCase())
  };
}

async function main() {
  console.log('=== AIOMETRIC-GoogleTAX - AI Beleganalyse ===');
  console.log('');
  
  const config = await loadConfig();
  
  if (!config.nvidiaApiKey) {
    console.error('ERROR: NVidia API key missing');
    console.log('Please set NVIDIA_API_KEY in .env');
    process.exit(1);
  }
  
  if (!config.spreadsheetId) {
    console.error('ERROR: Google Sheet ID missing');
    console.log('Please set GOOGLE_SHEET_ID in .env');
    process.exit(1);
  }
  
  console.log('Initializing services...');
  
  const driveService = new GoogleDriveService(config.googleCredentialsPath);
  const sheets = new GoogleSheetsService(config.googleCredentialsPath, config.spreadsheetId);
  const aiClient = new NvidiaAIClient(config.nvidiaApiKey);
  
  console.log('Initializing Google Sheets...');
  await sheets.init();
  
  const router = new FileRouter(driveService, sheets, aiClient, config.targetDriveFolderId);
  
  console.log('');
  console.log(`Source Drive Folder: ${config.sourceDriveFolderId}`);
  console.log(`Target Drive Folder: ${config.targetDriveFolderId}`);
  console.log(`Accounting Root Folder: ${config.accountingRootFolderId}`);
  console.log('');
  
  console.log('Fetching files from source folder...');
  const files = await driveService.listFilesRecursive(config.sourceDriveFolderId);
  
  console.log(`Found ${files.length} files in source folder`);
  
  if (config.syncOnly) {
    console.log('SYNC_ONLY active: skipping AI processing and only synchronizing Drive -> Sheets.');
  } else if (files.length > 0) {
    console.log('');
    console.log('Processing files...');
    console.log('');
    
    const result = await router.processAllFiles(files);
    
    console.log('');
    console.log('=== Processing Complete ===');
    console.log(`Total files: ${result.processed}`);
    console.log(`Successful: ${result.successful}`);
    console.log(`Failed: ${result.failed}`);
    console.log('');
    
    if (result.results.length > 0) {
      console.log('Results:');
      for (const r of result.results) {
        const status = r.success ? 'OK' : 'FAIL';
        console.log(`  [${status}] ${r.file} -> ${r.targetFolder || r.error}`);
      }
    }
  } else {
    console.log('No files in source folder. Continuing with Drive/Sheets synchronization.');
  }
  
  console.log('');
  console.log('Synchronizing Google Sheets with Drive...');
  const syncedRecords = await reconcileSheetsWithDrive(
    driveService,
    sheets,
    config.sourceDriveFolderId,
    config.targetDriveFolderId,
    config.accountingRootFolderId
  );
  await sheets.syncYearlySheets(syncedRecords);
  const folderSync = await syncFolderTabs(config.googleCredentialsPath, config.spreadsheetId, config.accountingRootFolderId);
  console.log(`Synchronized ${syncedRecords.length} records and refreshed yearly tabs.`);
  console.log(`Synchronized ${folderSync.synced} folder tabs and removed ${folderSync.removed} stale folder tabs.`);

  console.log('');
  const allBelege = await sheets.getAllBelege();
  console.log(`Total records in Google Sheets: ${allBelege.length}`);
  
  const byCategory = new Map<string, number>();
  for (const beleg of allBelege) {
    const count = byCategory.get(beleg.category) || 0;
    byCategory.set(beleg.category, count + 1);
  }
  
  console.log('By category:');
  for (const [category, count] of byCategory) {
    console.log(`  ${category}: ${count}`);
  }
  
  console.log('');
  console.log(`Google Sheet: ${sheets.getSpreadsheetUrl()}`);
  
  router.cleanup();
  
  console.log('');
  console.log('Done!');
}

async function reconcileSheetsWithDrive(
  driveService: GoogleDriveService,
  sheets: GoogleSheetsService,
  sourceFolderId: string,
  targetRootFolderId: string,
  accountingRootFolderId: string
): Promise<Partial<BelegRecord>[]> {
  const runId = randomUUID();
  const nowIso = new Date().toISOString();
  const actionPriority: Record<ReconcileActionType, number> = {
    DELETE_DUPLICATE: 1,
    DELETE_ORPHAN: 2,
    DELETE_YEARLY_ORPHAN: 3,
    INSERT_MISSING: 4,
    INSERT_YEARLY_MISSING: 5,
    UPDATE_YEAR: 6,
    UPDATE_CATEGORY: 7
  };
  const categoryFolders = await sheets.getAllCategoryFolders();
  const categoryByFolderId = new Map<string, string>();
  for (const folder of categoryFolders) {
    categoryByFolderId.set(folder.folder_id, folder.category);
  }

  const driveFilesById = new Map<string, DriveFile>();
  const rootsToScan = new Set<string>([sourceFolderId, targetRootFolderId]);
  const topLevelEntries = await driveService.listFiles(accountingRootFolderId);
  for (const entry of topLevelEntries) {
    if (entry.mimeType !== 'application/vnd.google-apps.folder') {
      continue;
    }
    const isYearFolder = /^20\d{2}$/.test(entry.name);
    const isExplicitRoot = entry.id === sourceFolderId || entry.id === targetRootFolderId;
    const isAdditionalActiveFolder = ['Sonstige_Belege', 'Neue Belege', 'Neue Belege '].includes(entry.name);
    if (isYearFolder || isExplicitRoot || isAdditionalActiveFolder) {
      rootsToScan.add(entry.id);
    }
  }

  for (const rootFolderId of rootsToScan) {
    const files = await driveService.listFilesRecursive(rootFolderId);
    for (const file of files) {
      driveFilesById.set(file.id, file);
    }
  }

  const existingRecords = await sheets.getAllBelege();
  const existingByDriveId = new Map<string, BelegRecord[]>();
  for (const record of existingRecords) {
    const list = existingByDriveId.get(record.drive_file_id) || [];
    list.push(record);
    existingByDriveId.set(record.drive_file_id, list);
  }

  const getYear = (value: string): string => {
    const iso = /^(\d{4})/.exec(value);
    if (iso) return iso[1];
    const generic = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(value);
    if (generic) return generic[1];
    return '';
  };

  const buildSortKey = (
    driveFileId: string,
    record: Partial<BelegRecord> | undefined,
    fallbackName: string,
    fallbackCategory: string
  ): string => {
    const name = (record?.original_name || fallbackName || '').trim();
    const category = (record?.category || fallbackCategory || '').trim();
    const year = getYear(name) || getYear(record?.analyzed_at || '') || '0000';
    return `${year}|${category}|${name}|${driveFileId}`;
  };

  const reconcileActions: ReconcileAction[] = [];
  const normalizedExisting = new Map<string, BelegRecord>();
  for (const [driveId, rows] of existingByDriveId.entries()) {
    const canonical = [...rows].sort((a, b) => {
      const aTs = Date.parse(a.analyzed_at || '');
      const bTs = Date.parse(b.analyzed_at || '');
      const aVal = Number.isFinite(aTs) ? aTs : Number.MAX_SAFE_INTEGER;
      const bVal = Number.isFinite(bTs) ? bTs : Number.MAX_SAFE_INTEGER;
      if (aVal !== bVal) return aVal - bVal;
      return (a.id || '').localeCompare(b.id || '');
    })[0];
    normalizedExisting.set(driveId, canonical);
    if (rows.length > 1) {
      for (const duplicate of rows.slice(1)) {
        reconcileActions.push({
          type: 'DELETE_DUPLICATE',
          reason: 'DUPLICATE_DRIVE_ID',
          target: 'belege',
          driveFileId: driveId,
          scopeYear: getYear(canonical.original_name || '') || getYear(canonical.analyzed_at || '') || '0000',
          before: duplicate as unknown as Record<string, unknown>,
          after: canonical as unknown as Record<string, unknown>,
          sortKey: buildSortKey(driveId, canonical, canonical.original_name || '', canonical.category || '')
        });
      }
    }
  }

  const reconciled = Array.from(driveFilesById.values())
    .filter((file) => {
      const currentFolderId = file.parents?.[0] || '';
      if (!currentFolderId) return true;
      return currentFolderId !== DUPLICATE_FOLDER_ID && currentFolderId !== MISSING_FOLDER_ID;
    })
    .map((file) => {
      const currentFolderId = file.parents?.[0] || '';
      const existing = normalizedExisting.get(file.id);
      const existingCategory = existing?.category || '';
      const categoryFromFolder = categoryByFolderId.get(currentFolderId);
      const category = categoryFromFolder || existingCategory || 'Sonstiges';
      const analyzedAt = existing?.analyzed_at || nowIso;
      const movedAt = existing?.moved_at || (currentFolderId !== sourceFolderId ? analyzedAt : '');
      const nextRecord = {
        id: existing?.id || randomUUID(),
        drive_file_id: file.id,
        original_name: file.name,
        mime_type: file.mimeType,
        file_size: Number.parseInt(file.size || '0', 10),
        category,
        extracted_text: existing?.extracted_text || '',
        ocr_text: existing?.ocr_text || '',
        image_description: existing?.image_description || '',
        tags: existing?.tags || '[]',
        metadata: existing?.metadata || '{}',
        confidence: Number(existing?.confidence || 0),
        source_folder_id: sourceFolderId,
        source_folder_url: `https://drive.google.com/drive/folders/${sourceFolderId}`,
        target_folder_id: currentFolderId,
        target_folder_url: currentFolderId ? `https://drive.google.com/drive/folders/${currentFolderId}` : '',
        analyzed_at: analyzedAt,
        moved_at: movedAt,
        file_url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
      } as Partial<BelegRecord>;

      if (!existing) {
        reconcileActions.push({
          type: 'INSERT_MISSING',
          reason: 'MISSING_IN_SHEET',
          target: 'belege',
          driveFileId: file.id,
          scopeYear: getYear(file.name || '') || getYear(nextRecord.analyzed_at || '') || '0000',
          before: {},
          after: nextRecord as unknown as Record<string
```
