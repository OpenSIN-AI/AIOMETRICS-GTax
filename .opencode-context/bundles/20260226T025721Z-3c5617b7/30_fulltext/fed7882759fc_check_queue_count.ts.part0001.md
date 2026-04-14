# Context Fulltext

- source_path: check_queue_count.ts
- source_sha256: 3c3794e5e099485df6d6915b6e1312c5ea3523574c22c95a9058207d4147cb3b
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
    range: 'QA_Queue_Global!A:A'
  });
  console.log(`Queue count: ${resp.data.values?.length || 0}`);
}
run();

```
