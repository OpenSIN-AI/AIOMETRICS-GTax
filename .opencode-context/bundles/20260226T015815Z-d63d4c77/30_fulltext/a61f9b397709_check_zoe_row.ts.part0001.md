# Context Fulltext

- source_path: check_zoe_row.ts
- source_sha256: 0cec49ea94a3e29b4ba2c6fad4f93021e0f8a9fb2277a49e57179d17102cc01b
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
dotenv.config();
const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});
const sheets = google.sheets({ version: 'v4', auth });
async function check() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'belege!A1:Z'
  });
  const rows = res.data.values || [];
  const headers = rows[0] || [];
  const idCol = headers.indexOf('drive_file_id');
  const ocrCol = headers.indexOf('ocr_text');
  const row = rows.find(r => r[idCol] === '1BfR5sxx9kXlUbEdK6OeGAy-kUI72Y5p3');
  console.log('Row found:', !!row);
  if (row) {
    console.log('OCR Text length:', row[ocrCol]?.length || 0);
    console.log('OCR Text excerpt:', row[ocrCol]?.slice(0, 100));
  }
}
check();

```
