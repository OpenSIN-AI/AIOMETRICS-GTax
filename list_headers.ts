import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as dotenv from 'dotenv';
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const id = process.env.GOOGLE_SHEET_ID;

async function run() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const sheetNames = meta.data.sheets?.map(s => s.properties?.title) || [];
  console.log("Sheets:", sheetNames.join(', '));
  
  for (const sheet of ['Ausgaben_2023', 'Einnahmen_2023', 'Buchhaltung_DB']) {
    if (sheetNames.includes(sheet)) {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${sheet}!A1:Z1`
      });
      console.log(`${sheet} headers:`, resp.data.values?.[0] || 'EMPTY');
    }
  }
}
run().catch(console.error);
