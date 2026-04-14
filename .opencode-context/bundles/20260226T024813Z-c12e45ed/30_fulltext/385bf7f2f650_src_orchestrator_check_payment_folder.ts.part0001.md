# Context Fulltext

- source_path: src/orchestrator/check_payment_folder.ts
- source_sha256: 9228f0e0902008bf5b2f971719afe22b8d0832043edba91db01b4fb2d61ed8e4
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();
const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

const FOLDER_ID = '1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU';

async function listFiles() {
  const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true
  });
  console.log(`Found ${res.data.files?.length} payment screenshots.`);
  res.data.files?.forEach(f => console.log(`- ${f.name} (${f.id})`));
}
listFiles().catch(console.error);

```
