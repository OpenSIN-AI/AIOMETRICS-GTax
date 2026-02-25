import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
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
