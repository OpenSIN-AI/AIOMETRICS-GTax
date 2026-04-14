# Context Fulltext

- source_path: src/orchestrator/cleanup_local_files.ts
- source_sha256: a76898bfc309fe59b50c520ee98908083c9bd00e66b18ee05fa209bc3a27cbb1
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';

const LOCAL_FOLDERS_TO_CLEAN = [
  "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud",
  "/Users/jeremy/NotebookLM/JS - Belegdokumente 2023"
];

interface DriveFileInfo {
  id: string;
  name: string;
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === maxAttempts) throw error;
      const waitMs = attempt * 2500;
      console.warn(`${op}: rate limited, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${op}: exhausted retries`);
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
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

async function listAllDriveFiles(driveApi: drive_v3.Drive, rootFolderId: string): Promise<Set<string>> {
  const fileNames = new Set<string>();
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const children = await listChildren(driveApi, current);
    for (const child of children) {
      const childId = child.id || '';
      const childName = child.name || '';
      if (!childId || !childName) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        queue.push(childId);
      } else {
        fileNames.add(childName);
      }
    }
  }
  return fileNames;
}

function getLocalFiles(dirPath: string): string[] {
    let allFiles: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            allFiles = allFiles.concat(getLocalFiles(fullPath));
        } else {
            allFiles.push(fullPath);
        }
    }
    return allFiles;
}


async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const driveApi = google.drive({ version: 'v3', auth });

  console.log('Fetching all file names from Google Drive...');
  const driveFileNames = await listAllDriveFiles(driveApi, ACCOUNTING_ROOT_FOLDER_ID);
  console.log(`Found ${driveFileNames.size} unique files in Google Drive.`);

  let deletedCount = 0;
  let keptCount = 0;

  for (const folder of LOCAL_FOLDERS_TO_CLEAN) {
    console.log(`\nProcessing local folder: ${folder}`);
    if (!fs.existsSync(folder)) {
        console.log(`Folder does not exist, skipping.`);
        continue;
    }
    const localFiles = getLocalFiles(folder);

    for (const localFile of localFiles) {
        const fileName = path.basename(localFile);
        if (driveFileNames.has(fileName)) {
            try {
                fs.unlinkSync(localFile);
                console.log(`DELETED: ${localFile}`);
                deletedCount++;
            } catch (error) {
                console.error(`Failed to delete ${localFile}:`, error);
            }
        } else {
            console.log(`KEPT: ${localFile}`);
            keptCount++;
        }
    }
  }

  console.log(`\nCleanup complete.`);
  console.log(`Deleted: ${deletedCount} files (simulation)`);
  console.log(`Kept: ${keptCount} files`);
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});

```
