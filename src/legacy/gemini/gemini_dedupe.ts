import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const FOLDER_DUPLICATE = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function moveFile(fileId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const parents = file.data.parents || [];
    if (parents.includes(FOLDER_DUPLICATE)) return;

    await drive.files.update({
      fileId,
      addParents: FOLDER_DUPLICATE,
      removeParents: parents.join(','),
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[DUPLICATE MOVED] ${fileName}`);
  } catch (err: any) {
    console.error(`[ERROR] moving ${fileName}: ${err.message}`);
  }
}

async function runDedupe() {
  console.log('--- STARTING DEDUPE ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  const idCol = headers.indexOf('drive_file_id');
  const nameCol = headers.indexOf('dateiname_original');
  const dateCol = headers.indexOf('belegdatum');
  const amountCol = headers.indexOf('brutto_gesamt');
  const supplierCol = headers.indexOf('lieferant');

  const seen = new Map<string, string>(); // Key -> FileID
  let moved = 0;

  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const id = row[idCol];
      if (!id) continue;

      const date = row[dateCol];
      const amount = row[amountCol];
      const supplier = (row[supplierCol] || '').toLowerCase();
      
      // Only dedupe if we have sufficient data
      if (date && amount && supplier && supplier !== 'unklar') {
          const key = `${date}|${amount}|${supplier}`;
          
          if (seen.has(key)) {
              console.log(`Duplicate found: ${row[nameCol]} matches ${seen.get(key)}`);
              // Move THIS one (the second occurrence)
              await moveFile(id, row[nameCol]);
              moved++;
          } else {
              seen.set(key, row[nameCol]);
          }
      }
  }
  
  console.log(`Dedupe finished. Moved ${moved} files.`);
}

runDedupe().catch(console.error);
