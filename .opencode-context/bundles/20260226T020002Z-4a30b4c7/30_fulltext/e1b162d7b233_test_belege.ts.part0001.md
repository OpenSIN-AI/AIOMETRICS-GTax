# Context Fulltext

- source_path: test_belege.ts
- source_sha256: 7d97939403356e1212ca527f832d37ccddf387d3297575684cf9e2e0cfef48ef
- chunk: 1/1

```text
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as dotenv from 'dotenv';
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const id = process.env.GOOGLE_SHEET_ID;

async function run() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `belege!A1:Z1`
  });
  console.log(`belege headers:`, resp.data.values?.[0] || 'EMPTY');
}
run().catch(console.error);

```
