import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function run() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'QA_Queue_Global!A:Z'
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return;
  
  const headers = rows[0];
  const yearIdx = headers.indexOf('belegdatum');
  const nameIdx = headers.indexOf('dateiname_original');
  
  const yearCounts: Record<string, number> = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let year = 'Unknown';
    const dateStr = r[yearIdx] || '';
    const nameStr = r[nameIdx] || '';
    
    if (dateStr.includes('2022') || nameStr.includes('2022')) year = '2022';
    else if (dateStr.includes('2023') || nameStr.includes('2023')) year = '2023';
    else if (dateStr.includes('2024') || nameStr.includes('2024')) year = '2024';
    else if (dateStr.includes('2025') || nameStr.includes('2025')) year = '2025';
    else if (dateStr.includes('2026') || nameStr.includes('2026')) year = '2026';
    
    yearCounts[year] = (yearCounts[year] || 0) + 1;
  }
  console.log('QA Queue Year Distribution:', yearCounts);
}
run();
