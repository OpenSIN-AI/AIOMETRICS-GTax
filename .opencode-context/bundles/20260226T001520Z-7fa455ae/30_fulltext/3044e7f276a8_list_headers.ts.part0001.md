# Context Fulltext

- source_path: list_headers.ts
- source_sha256: a712e3eb3993fe329bda152cf3a1048434271a4f528876a776c91d8002e5da13
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
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const sheetNames = meta.data.sheets?.map(s => s.properties?.title) || [];
  console.log("Sheets:", sheetNames.join(', '));
  
  for (const sheet of ['Ausgaben_2023', 'Einnahmen_2023', 'Buchhaltung_DB']) {
    if (sheetNames.includes(sheet)) {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${sheet}!A1:Z1`
      });
      console.log(`${sheet} headers:`, resp.data.values?.[0] || 'EMPTY');
    }
  }
}
run().catch(console.error);

```
