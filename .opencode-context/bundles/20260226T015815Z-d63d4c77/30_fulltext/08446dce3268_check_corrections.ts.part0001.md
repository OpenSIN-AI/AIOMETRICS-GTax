# Context Fulltext

- source_path: check_corrections.ts
- source_sha256: eb6a825e27d3677b19abeabccbeb5396e2a200839ff22ddea7957f551ed9a31d
- chunk: 1/1

```text
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function run() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'QA_Corrections_Global!A1:Z'
  });
  console.log(`Corrections count: ${resp.data.values?.length || 0}`);
}
run();

```
