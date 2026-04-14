# Context Fulltext

- source_path: test_db.ts
- source_sha256: f19e7de3506c554df98af93648c0ca28224911c56a98807b01c94190340d9ca2
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
    range: `Buchhaltung_DB!A1:Z`
  });
  console.log(`Buchhaltung_DB total rows:`, resp.data.values?.length || 0);
  if (resp.data.values && resp.data.values.length > 1) {
    let year23 = 0;
    for (const r of resp.data.values) {
        if (r.join(' ').includes('2023')) year23++;
    }
    console.log(`Buchhaltung_DB 2023 rows approx:`, year23);
  }
}
run().catch(console.error);

```
