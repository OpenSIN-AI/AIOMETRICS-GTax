import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function check() {
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ1',
  });
  console.log(meta.data.values?.[0]);
}
check();
