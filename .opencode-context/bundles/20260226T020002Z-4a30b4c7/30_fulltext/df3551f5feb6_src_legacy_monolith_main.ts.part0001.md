# Context Fulltext

- source_path: src/legacy/monolith/main.ts
- source_sha256: 1879dfb4721fc5b373a7285c1890147562a8a8ec1b9be62afdc899f6c9d1e95f
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
import { BelegRecord, GoogleSheetsService } from '../db/googleSheetsService.js';
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
  console.log('=== Jerry Belege - AI Beleganalyse ===');
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
  const existingByDriveId = new Map<string, BelegRecord>();
  for (const record of existingRecords) {
    existingByDriveId.set(record.drive_file_id, record);
  }

  const reconciled = Array.from(driveFilesById.values())
    .filter((file) => {
      const currentFolderId = file.parents?.[0] || '';
      if (!currentFolderId) return true;
      return currentFolderId !== DUPLICATE_FOLDER_ID && currentFolderId !== MISSING_FOLDER_ID;
    })
    .map((file) => {
      const currentFolderId = file.parents?.[0] || '';
      const existing = existingByDriveId.get(file.id);
      const existingCategory = existing?.category || '';
      const categoryFromFolder = categoryByFolderId.get(currentFolderId);
      const category = categoryFromFolder || existingCategory || 'Sonstiges';
      const nowIso = new Date().toISOString();
      const analyzedAt = existing?.analyzed_at || nowIso;
      const movedAt = existing?.moved_at || (currentFolderId !== sourceFolderId ? analyzedAt : '');

      return {
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
    })
    .sort((a, b) => (a.original_name || '').localeCompare(b.original_name || ''));

  await sheets.replaceAllBelege(reconciled);
  return reconciled;
}

function folderTabTitle(name: string): string {
  return `Ordner_${name}`.replace(/[\[\]\*\?\/\\]/g, '_').slice(0, 95);
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = attempt * 2500;
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function listFolderChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined = undefined;

  do {
    const listResponse: any = await driveApi.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: [REDACTED]
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(listResponse.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);

  return out;
}

async function createGoogleApis(credentialsPath: [REDACTED]
  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  return {
    driveApi: google.drive({ version: 'v3', auth }),
    sheetsApi: google.sheets({ version: 'v4', auth })
  };
}

async function syncFolderTabs(
  credentialsPath: [REDACTED]
  spreadsheetId: string,
  rootFolderId: string
): Promise<{ synced: number; removed: number }> {
  const { driveApi, sheetsApi } = await createGoogleApis(credentialsPath);
  const spreadsheet = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  });

  const sheetIdByTitle = new Map<string, number>();
  for (const sheet of spreadsheet.data.sheets || []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && typeof sheetId === 'number') {
      sheetIdByTitle.set(title, sheetId);
    }
  }

  const topLevel = (await listFolderChildren(driveApi, rootFolderId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  const expectedTitles = new Set<string>();
  let synced = 0;

  for (const folder of topLevel) {
    const name = folder.name || folder.id || 'Unbenannt';
    const folderId = folder.id || '';
    if (!folderId) continue;

    const title = folderTabTitle(name);
    expectedTitles.add(title);

    let sheetId = sheetIdByTitle.get(title);
    if (typeof sheetId !== 'number') {
      const created = await runWithRateLimitRetry(
        () => sheetsApi.spreadshe
```
