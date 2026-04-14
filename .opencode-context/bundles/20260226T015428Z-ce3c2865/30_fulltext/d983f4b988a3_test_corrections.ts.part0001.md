# Context Fulltext

- source_path: test_corrections.ts
- source_sha256: e6c3a65d840f05069d5eb3f5ffbd80bf3816b75d32a3229bbd50688931a538d9
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
    range: `QA_2023_Corrections!A1:Z`
  });
  console.log(`QA_2023_Corrections total rows:`, resp.data.values?.length || 0);
  if (resp.data.values && resp.data.values.length > 1) {
    console.log(`First correction sample:`, resp.data.values[1]);
  }
}
run().catch(console.error);

```
