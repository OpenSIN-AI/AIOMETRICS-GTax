import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const sheets = google.sheets({ version: 'v4', auth });

async function listUnknownSuppliers() {
  console.log('--- SEARCHING UNKNOWN SUPPLIERS (2023) ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:Z'
  });

  const rows = res.data.values || [];
  const headers = rows[0] || [];
  const idCol = headers.indexOf('drive_file_id');
  const nameCol = headers.indexOf('original_name');
  const catCol = headers.indexOf('category');

  const unknown = rows.filter(r => 
    String(r[catCol] || '').toLowerCase().includes('unklar') || 
    String(r[catCol] || '').toLowerCase().includes('unbekannt')
  ).slice(1, 51);

  console.log(`Found ${unknown.length} candidates.`);
  
  unknown.forEach(r => {
    console.log(`ID: ${r[idCol]} | Name: ${r[nameCol]}`);
  });
}

listUnknownSuppliers().catch(console.error);
