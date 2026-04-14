# Context Fulltext

- source_path: src/orchestrator/check_headers_belege.ts
- source_sha256: cd1bb0bbf0ec6a39d98e4032c748770f1476385d6a36362ae35fcdbfa550f67a
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
    range: 'belege!A1:AZ1',
  });
  console.log(meta.data.values?.[0]);
}
check();

```
