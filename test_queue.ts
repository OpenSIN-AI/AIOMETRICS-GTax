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
    range: `QA_2023_Queue!A1:Z`
  });
  console.log(`QA_2023_Queue total rows:`, resp.data.values?.length || 0);
}
run().catch(console.error);
