# Context Fulltext

- source_path: src/drive/googleDriveService.ts
- source_sha256: b91998bb2700aac9bd3fa7de43ceb791a9e9922d5a4b259360772bcf929804ba
- chunk: 1/2

```text
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  downloadUrl?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

interface ApiErrorLike {
  code?: string | number;
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
  };
  errors?: Array<{ reason?: string }>;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GoogleDriveService {
  private drive: drive_v3.Drive;
  private readonly requestTimeoutMs = parsePositiveInt(process.env.GDRIVE_REQUEST_TIMEOUT_MS, 30000);
  private readonly maxRetries = parsePositiveInt(process.env.GDRIVE_MAX_RETRIES, 4);
  private readonly retryBaseMs = parsePositiveInt(process.env.GDRIVE_RETRY_BASE_MS, 1500);
  
  constructor(private credentialsPath: [REDACTED]
    const auth = new JWT({
      keyFile: [REDACTED]
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    
    this.drive = google.drive({ version: 'v3', auth });
  }

  private extractError(error: unknown): { status: number; code: string; reason: string; message: string } {
    const err = (error || {}) as ApiErrorLike;
    const status = Number(err.response?.status || err.code || 0);
    const code = String(err.code || '');
    const reason =
      String(err.errors?.[0]?.reason || '') ||
      String(err.response?.data?.error?.errors?.[0]?.reason || '');
    const message = String(err.response?.data?.error?.message || err.message || '');
    return { status, code, reason, message };
  }

  private isRetryableError(error: unknown): boolean {
    const { status, code, reason, message } = this.extractError(error);
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
    if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) {
      return true;
    }
    if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'].includes(reason)) {
      return true;
    }
    const m = message.toLowerCase();
    return m.includes('timeout') || m.includes('rate limit') || m.includes('quota') || m.includes('backend error');
  }

  private async runWithRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const attempts = Math.max(1, this.maxRetries);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const retryable = this.isRetryableError(error);
        if (!retryable || attempt >= attempts) {
          throw error;
        }
        const meta = this.extractError(error);
        const delayMs = Math.min(15000, this.retryBaseMs * attempt + Math.floor(Math.random() * 250));
        console.warn(
          `[drive] ${operation} failed (attempt ${attempt}/${attempts}), retry in ${delayMs}ms: ${meta.message || meta.reason || meta.code || meta.status}`
        );
        await sleep(delayMs);
      }
    }
    throw new Error(`${operation}: exhausted retries`);
  }
  
  async listFiles(folderId: string): Promise<DriveFile[]> {
    try {
      const allFiles: drive_v3.Schema$File[] = [];
      let pageToken: [REDACTED] | undefined = undefined;

      do {
        const response = await this.runWithRetry(
          'drive.files.list',
          () => this.drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: [REDACTED]
            orderBy: 'modifiedTime desc',
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
          }, {
            timeout: this.requestTimeoutMs
          })
        );

        allFiles.push(...(response.data.files || []));
        pageToken = [REDACTED] || undefined;
      } while (pageToken);
      
      return allFiles.map(f => ({
        id: f.id || '',
        name: f.name || '',
        mimeType: f.mimeType || '',
        size: f.size ?? undefined,
        createdTime: f.createdTime ?? undefined,
        modifiedTime: f.modifiedTime ?? undefined,
        parents: f.parents ?? undefined,
        webViewLink: f.webViewLink ?? undefined
      }));
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }

  async listFilesRecursive(rootFolderId: string): Promise<DriveFile[]> {
    const queue: string[] = [rootFolderId];
    const visited = new Set<string>();
    const files: DriveFile[] = [];

    while (queue.length > 0) {
      const folderId = queue.shift();
      if (!folderId || visited.has(folderId)) {
        continue;
      }
      visited.add(folderId);

      const children = await this.listFiles(folderId);
      for (const child of children) {
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(child.id);
        } else {
          files.push(child);
        }
      }
    }

    return files;
  }
  
  async downloadFile(fileId: string, destPath: string): Promise<string> {
    try {
      const response = await this.runWithRetry(
        'drive.files.get.media',
        () => this.drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream', timeout: this.requestTimeoutMs }
        )
      );
      
      const writer = fs.createWriteStream(destPath);
      
      return new Promise((resolve, reject) => {
        response.data
          .on('end', () => {
            console.log(`Downloaded file to ${destPath}`);
            resolve(destPath);
          })
          .on('error', (err: Error) => {
            console.error('Error downloading file:', err);
            reject(err);
          })
          .pipe(writer);
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }
  
  async moveFile(fileId: string, newParentId: string): Promise<DriveFile> {
    try {
      const file = await this.runWithRetry(
        'drive.files.get.parents',
        () => this.drive.files.get({
          fileId,
          fields: 'parents',
          supportsAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      
      const previousParents = file.data.parents?.join(',') || '';
      
      const response = await this.runWithRetry(
        'drive.files.update.move',
        () => this.drive.files.update({
          fileId,
          addParents: newParentId,
          removeParents: previousParents,
          fields: 'id, name, mimeType, parents',
          supportsAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      
      return {
        id: response.data.id || '',
        name: response.data.name || '',
        mimeType: response.data.mimeType || '',
        parents: response.data.parents || undefined
      };
    } catch (error) {
      console.error('Error moving file:', error);
      throw error;
    }
  }
  
  async createFolder(name: string, parentId?: string): Promise<DriveFolder> {
    try {
      const folderMetadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId && { parents: [parentId] })
      };
      
      const response = await this.runWithRetry(
        'drive.files.create.folder',
        () => this.drive.files.create({
          requestBody: folderMetadata,
          fields: 'id, name',
          supportsAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      
      return {
        id: response.data.id || '',
        name: response.data.name || ''
      };
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }
  
  async findFolder(name: string, parentId?: string): Promise<DriveFolder | null> {
    try {
      let query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      if (parentId) {
        query += ` and '${parentId}' in parents`;
      }
      
      const response = await this.runWithRetry(
        'drive.files.list.findFolder',
        () => this.drive.files.list({
          q: query,
          fields: 'files(id, name)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      
      if (response.data.files && response.data.files.length > 0) {
        return {
          id: response.data.files[0].id || '',
          name: response.data.files[0].name || ''
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error finding folder:', error);
      throw error;
    }
  }
  
  async fileExists(name: string, parentId: string): Promise<boolean> {
    try {
      const response = await this.runWithRetry(
        'drive.files.list.fileExists',
        () => this.drive.files.list({
          q: `name = '${name}' and '${parentId}' in parents and trashed = false`,
          fields: 'files(id)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      
      return (response.data.files?.length || 0) > 0;
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }
  
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.runWithRetry(
        'drive.files.delete',
        () => this.drive.files.delete({ fileId, supportsAllDrives: true }, { timeout: this.requestTimeoutMs })
      );
      console.log(`Deleted file ${fileId}`);
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }
  
  async shareFileWithEmail(fileId: string, email: string, role: string = 'reader'): Promise<void> {
    try {
      await this.runWithRetry(
        'drive.permissions.create',
        () => this.drive.permissions.create({
          fileId,
          supportsAllDrives: true,
          requestBody: {
            type: 'user',
            role,
            emailAddress: email
          }
        }, {
          timeout: this.requestTimeoutMs
        })
      );
      console.log(`Shared file ${fileId} with ${email}`);
    } catch (error) {
      console.error('Error sharing file:', error);
      throw error;
    }
  }

  async getFileById(fileId: string): Promise<DriveFile | null> {
    try {
      const response = await this.runWithRetry(
        'drive.files.get.byId',
        () => this.drive.files.get({
          fileId,
          fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink',
          supportsAllDrives: true
        }, {
          timeout: this.requestTimeoutMs
        })
      );

      return {
        id: response.data.id || '',
        name: response.data.name || '',
        mimeType: response.data.mimeType || '',
        size: response.data.size ?? undefined,
        createdTime: response.data.createdTime ?? undefined,
        modifiedTime: response.data.modifiedTime ?? undefined,
        parents: response.data.parents ?? undefined,
        webViewLink: response.data.webViewLink ?? undefined
      };
    } catch (error: any) {
      const statusRaw = error?.response?.status || error?.cod
```
