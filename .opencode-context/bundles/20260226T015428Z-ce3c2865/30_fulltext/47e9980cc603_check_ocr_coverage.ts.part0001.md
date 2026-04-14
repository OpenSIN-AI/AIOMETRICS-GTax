# Context Fulltext

- source_path: check_ocr_coverage.ts
- source_sha256: 6a32f87ec2a431bceacd3846f9c0208728a5f513b67fdf1ce680a4f86753ab48
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
    range: 'belege!A:Z'
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return;
  
  const headers = rows[0];
  const ocrIdx = headers.indexOf('ocr_text');
  const extIdx = headers.indexOf('extracted_text');
  
  let ocrCount = 0;
  let extCount = 0;
  let bothCount = 0;
  let noneCount = 0;
  
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const hasOcr = !!r[ocrIdx];
    const hasExt = !!r[extIdx];
    
    if (hasOcr && hasExt) bothCount++;
    else if (hasOcr) ocrCount++;
    else if (hasExt) extCount++;
    else noneCount++;
  }
  console.log(`belege coverage:\nBoth: ${bothCount}\nOCR Only: ${ocrCount}\nExt Only: ${extCount}\nNone: ${noneCount}\nTotal: ${rows.length - 1}`);
}
run();

```
