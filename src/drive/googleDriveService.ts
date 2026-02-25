import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

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

export class GoogleDriveService {
  private drive: drive_v3.Drive;
  
  constructor(private credentialsPath: string) {
    const auth = new JWT({
      keyFile: credentialsPath,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    
    this.drive = google.drive({ version: 'v3', auth });
  }
  
  async listFiles(folderId: string): Promise<DriveFile[]> {
    try {
      const allFiles: drive_v3.Schema$File[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const response: any = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink)',
          orderBy: 'modifiedTime desc',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        allFiles.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken || undefined;
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
      const response = await this.drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
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
      const file = await this.drive.files.get({
        fileId,
        fields: 'parents',
        supportsAllDrives: true
      });
      
      const previousParents = file.data.parents?.join(',') || '';
      
      const response = await this.drive.files.update({
        fileId,
        addParents: newParentId,
        removeParents: previousParents,
        fields: 'id, name, mimeType, parents',
        supportsAllDrives: true
      });
      
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
      
      const response = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id, name',
        supportsAllDrives: true
      });
      
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
      
      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
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
      const response = await this.drive.files.list({
        q: `name = '${name}' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      return (response.data.files?.length || 0) > 0;
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }
  
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId, supportsAllDrives: true });
      console.log(`Deleted file ${fileId}`);
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }
  
  async shareFileWithEmail(fileId: string, email: string, role: string = 'reader'): Promise<void> {
    try {
      await this.drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        requestBody: {
          type: 'user',
          role,
          emailAddress: email
        }
      });
      console.log(`Shared file ${fileId} with ${email}`);
    } catch (error) {
      console.error('Error sharing file:', error);
      throw error;
    }
  }

  async getFileById(fileId: string): Promise<DriveFile | null> {
    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink',
        supportsAllDrives: true
      });

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
      const status = error?.response?.status || error?.code;
      if (status === 404) {
        return null;
      }
      console.error('Error getting file by id:', error);
      throw error;
    }
  }
}
