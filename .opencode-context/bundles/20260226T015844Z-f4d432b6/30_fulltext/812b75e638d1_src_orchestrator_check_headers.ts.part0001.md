# Context Fulltext

- source_path: src/orchestrator/check_headers.ts
- source_sha256: 6a114a9189b8285bb8268741694a0c0757231629fbfb31282f677ef4ca25aa27
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
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

```
