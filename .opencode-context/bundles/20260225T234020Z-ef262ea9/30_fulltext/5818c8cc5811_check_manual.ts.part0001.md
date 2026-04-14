# Context Fulltext

- source_path: check_manual.ts
- source_sha256: 59fd94dfcd973a3a06fd7e2efcd8e0183b2bb271200441ba8f9eef0dfbfe5ef2
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
    range: 'QA_Manual_Review!A1:Z'
  });
  console.log(`Manual Review count: ${resp.data.values?.length || 0}`);
}
run();

```
