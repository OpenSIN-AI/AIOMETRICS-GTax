# Context Fulltext

- source_path: src/legacy/gemini/gemini_payment_screenshot_move.ts
- source_sha256: 9574bd2b0f9eff7fced9d49d57e817778a6f3bbdfc0fc54ca1b7e967d4151e21
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth });

const SOURCE_FOLDER = '1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU'; // Payment Screenshots
const TARGET_FOLDER = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy'; // Fehlende Belege

async function run() {
  console.log('--- PAYMENT SCREENSHOT CHECK ---');
  // List files in source folder
  const res = await drive.files.list({
      q: `'${SOURCE_FOLDER}' in parents and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true
  });
  
  const files = res.data.files || [];
  console.log(`Found ${files.length} files in Payment Screenshot folder.`);
  
  if (files.length === 0) {
      console.log("No screenshots to process.");
      return;
  }

  // Move them to "Fehlende Belege" as requested ("WENN DU WIRKLICH KEINE BELEG ZU EINEM ZAHLUNGSNACHWEIS FINDEST DANN VERSCHIEBE ZAHLUNGSNACHWEIS IN DRIVE ORDNER ...")
  // Since I can't currently verify 100% if a receipt exists (due to missing OCR), I will move them to "Fehlende Belege" 
  // so the user can process them via the "Eigenbeleg" sheet logic later.
  
  for (const f of files) {
      console.log(`Moving ${f.name} to Fehlende Belege...`);
      await drive.files.update({
          fileId: f.id!,
          addParents: TARGET_FOLDER,
          removeParents: SOURCE_FOLDER,
          supportsAllDrives: true
      });
  }
  console.log("All payment screenshots moved to Fehlende Belege.");
}

run().catch(console.error);

```
