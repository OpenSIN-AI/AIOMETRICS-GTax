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
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `Buchhaltung_DB!A1:Z`
  });
  console.log(`Buchhaltung_DB total rows:`, resp.data.values?.length || 0);
  if (resp.data.values && resp.data.values.length > 1) {
    let year23 = 0;
    for (const r of resp.data.values) {
        if (r.join(' ').includes('2023')) year23++;
    }
    console.log(`Buchhaltung_DB 2023 rows approx:`, year23);
  }
}
run().catch(console.error);
