# Context Fulltext

- source_path: test_corrections_global.ts
- source_sha256: b51aebddae81f3238b5616146e7ca2c22acd0b00e3a4504087a9a7644bc05264
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
    range: 'QA_Corrections_Global!A1:Z10'
  });
  console.log(`Global Corrections sample:`, resp.data.values);
}
run();

```
