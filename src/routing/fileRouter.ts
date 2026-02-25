import { GoogleDriveService, DriveFile } from '../drive/googleDriveService.js';
import { GoogleSheetsService } from '../db/googleSheetsService.js';
import { NvidiaAIClient, AnalysisResult } from '../ai/nvidiaAIClient.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RoutingRule {
  category: string;
  folderName: string;
}

const DEFAULT_ROUTES: RoutingRule[] = [
  { category: 'Rechnungen', folderName: 'Rechnungen' },
  { category: 'Quittungen', folderName: 'Quittungen' },
  { category: 'Vertraege', folderName: 'Vertraege' },
  { category: 'Angebote', folderName: 'Angebote' },
  { category: 'Sonstiges', folderName: 'Sonstige_Belege' },
  { category: 'fehler', folderName: 'Fehler' }
];

export class FileRouter {
  private tempDir: string;
  private categoryFolderMapPromise: Promise<Map<string, string>> | null = null;
  
  constructor(
    private driveService: GoogleDriveService,
    private sheets: GoogleSheetsService,
    private aiClient: NvidiaAIClient,
    private targetFolderId: string
  ) {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiometric-googletax-'));
  }
  
  async ensureCategoryFolders(): Promise<Map<string, string>> {
    if (this.categoryFolderMapPromise) {
      return this.categoryFolderMapPromise;
    }

    this.categoryFolderMapPromise = this.createCategoryFolders();
    return this.categoryFolderMapPromise;
  }

  private async createCategoryFolders(): Promise<Map<string, string>> {
    const folderMap = new Map<string, string>();
    
    for (const rule of DEFAULT_ROUTES) {
      let folder = await this.driveService.findFolder(rule.folderName, this.targetFolderId);
      
      if (!folder) {
        folder = await this.driveService.createFolder(rule.folderName, this.targetFolderId);
        console.log(`Created folder: ${folder.name} (${folder.id})`);
      }
      
      folderMap.set(rule.category, folder.id);
      await this.sheets.saveCategoryFolder(rule.category, folder.id, folder.name);
    }
    
    return folderMap;
  }
  
  async routeFile(driveFile: DriveFile): Promise<{ success: boolean; targetFolder?: string; error?: string; fileUrl?: string }> {
    try {
      await this.sheets.logProcessing(driveFile.id, 'routeFile', 'started');
      
      const tempPath = path.join(this.tempDir, driveFile.name);
      await this.driveService.downloadFile(driveFile.id, tempPath);
      console.log(`Downloaded: ${driveFile.name}`);
      
      const analysis = await this.aiClient.analyzeFile({
        filePath: tempPath,
        fileName: driveFile.name,
        mimeType: driveFile.mimeType
      });
      
      console.log(`Analyzed: ${driveFile.name} - Category: ${analysis.category}`);
      
      const category = this.aiClient.categorizeFile(analysis);
      const folderMap = await this.ensureCategoryFolders();
      const targetFolderId = folderMap.get(category) || folderMap.get('Sonstiges')!;
      
      const fileUrl = `https://drive.google.com/file/d/${driveFile.id}/view`;
      const sourceFolderId = driveFile.parents?.[0] || '';
      const sourceFolderUrl = sourceFolderId ? `https://drive.google.com/drive/folders/${sourceFolderId}` : '';
      const targetFolderUrl = `https://drive.google.com/drive/folders/${targetFolderId}`;
      
      await this.driveService.moveFile(driveFile.id, targetFolderId);

      const movedAt = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        drive_file_id: driveFile.id,
        original_name: driveFile.name,
        mime_type: driveFile.mimeType,
        file_size: parseInt(driveFile.size || '0'),
        category: category,
        extracted_text: analysis.extractedText || '',
        ocr_text: analysis.ocrText || '',
        image_description: analysis.imageDescription || '',
        tags: JSON.stringify(analysis.tags || []),
        metadata: JSON.stringify(analysis.metadata || {}),
        confidence: analysis.confidence,
        source_folder_id: sourceFolderId,
        source_folder_url: sourceFolderUrl,
        target_folder_id: targetFolderId,
        target_folder_url: targetFolderUrl,
        analyzed_at: movedAt,
        moved_at: movedAt,
        file_url: fileUrl
      };
      
      await this.sheets.saveBeleg(record);
      
      await this.sheets.logProcessing(driveFile.id, 'routeFile', 'completed', `Moved to ${category}`);
      
      fs.unlinkSync(tempPath);
      
      console.log(`Routed: ${driveFile.name} -> ${category}`);
      
      return { success: true, targetFolder: category, fileUrl };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error routing file ${driveFile.name}:`, errorMsg);
      
      await this.sheets.logProcessing(driveFile.id, 'routeFile', 'failed', errorMsg);
      
      try {
        const folderMap = await this.ensureCategoryFolders();
        const errorFolderId = folderMap.get('fehler')!;
        await this.driveService.moveFile(driveFile.id, errorFolderId);
      } catch (moveError) {
        console.error('Failed to move to error folder:', moveError);
      }
      
      return { success: false, error: errorMsg };
    }
  }
  
  async processAllFiles(driveFiles: DriveFile[]): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: any[];
  }> {
    const results: any[] = [];
    let successful = 0;
    let failed = 0;
    
    const existing = await this.sheets.getAllBelege();
    const processedIds = new Set(
      existing
        .filter((record) => Boolean(record.moved_at) && record.extracted_text !== 'Fehler bei der PDF-Analyse')
        .map((record) => record.drive_file_id)
    );

    for (const file of driveFiles) {
      if (file.mimeType.startsWith('application/vnd.google-apps')) {
        console.log(`Skipping non-binary Google file: ${file.name} (${file.mimeType})`);
        continue;
      }

      if (processedIds.has(file.id)) {
        console.log(`Skipping already processed: ${file.name}`);
        continue;
      }
      
      const result = await this.routeFile(file);
      results.push({ file: file.name, ...result });
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }
    
    return {
      processed: driveFiles.length,
      successful,
      failed,
      results
    };
  }
  
  cleanup(): void {
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true });
    }
  }
}
