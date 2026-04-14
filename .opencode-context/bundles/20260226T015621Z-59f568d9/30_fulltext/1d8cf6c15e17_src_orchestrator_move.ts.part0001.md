# Context Fulltext

- source_path: src/orchestrator/move.ts
- source_sha256: 0d67d790869e5d940abcc6cc0fb1052715053196d5e44dd8ff9fb6adfc561d34
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { GoogleDriveService } from '../drive/googleDriveService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

async function main() {
  const credsPath = '/Users/jeremy/.credentials/credentials.json';
  const sourceFolderId = '1-d-9DzcFn2hSh93DKHqGl1Uysvtf2aGN';
  const targetFolderId = '1GM72x8nkwpSxaj9qxKNUv9h4Hmfw2qA3';
  
  const drive = new GoogleDriveService(credsPath);
  
  console.log('Fetching files from source folder...');
  const files = await drive.listFiles(sourceFolderId);
  
  console.log(`Found ${files.length} files`);
  
  for (const file of files) {
    console.log(`Moving: ${file.name}`);
    await drive.moveFile(file.id, targetFolderId);
    console.log(`  -> Moved to ${targetFolderId}`);
  }
  
  console.log('Done!');
}

withPipelineLock('move', main).catch((error) => {
  console.error('move failed:', error);
  process.exit(1);
});

```
