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
    range: `QA_2023_Corrections!A1:Z`
  });
  console.log(`QA_2023_Corrections total rows:`, resp.data.values?.length || 0);
  if (resp.data.values && resp.data.values.length > 1) {
    console.log(`First correction sample:`, resp.data.values[1]);
  }
}
run().catch(console.error);
