# Context Fulltext

- source_path: priority_ocr_zoe_gemini.ts
- source_sha256: 15f7e5e8c6b813960986236ef43b155c425e39a51bca7c9801188e8920800299
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

dotenv.config();

const API_KEY = [REDACTED]; // Assuming this is set
const SPREADSHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

const FILE_IDS = [
  '1BfR5sxx9kXlUbEdK6OeGAy-kUI72Y5p3',
  '1hV_mZY4LQlRTbHMfJhBn8avCgEeS3NgP',
  '1rBrv6hepoSCEy8_P_WY5ISUF2t9QhQ03',
  '1upLYTtIpMnJkhptgjFlIS8To--lYxfXf',
  '1Y1kt3kMjh4CJfGbiZj9P_qLPnae2an1k'
];

async function run() {
  if (!API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    return;
  }
  console.log('Priority OCR for Zoe Solar Invoices using Gemini 3 Flash...');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:Z'
  });
  const rows = res.data.values || [];
  const headers = rows[0] || [];
  const idCol = headers.indexOf('drive_file_id');
  const ocrTextCol = headers.indexOf('ocr_text');
  const metadataCol = headers.indexOf('metadata');
  
  const updates: any[] = [];

  for (const id of FILE_IDS) {
    console.log(`Processing ${id}...`);
    const rowIndex = rows.findIndex(r => r[idCol] === id) + 1;
    if (rowIndex <= 0) continue;
    
    const tempFile = path.join(os.tmpdir(), `${id}.png`);
    const driveRes = await drive.files.get(
      { fileId: id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(tempFile, Buffer.from(driveRes.data as ArrayBuffer));
    const base64 = fs.readFileSync(tempFile).toString('base64');
    
    const payload = {
      contents: [{
        parts: [
          { text: 'Extrahiere den Text aus dieser Rechnung. Besonders Betrag, Datum und Rechnungsnummer.' },
          { inline_data: { mime_type: 'image/png', data: base64 } }
        ]
      }]
    };
    
    const url = `https: [REDACTED]
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data: any = await response.json();
      if (data.candidates && data.candidates[0].content.parts[0].text) {
          const text = data.candidates[0].content.parts[0].text;
          console.log(`Extracted text for ${id}: ${text.length} chars`);
          
          const metaObj = {
              extraction_status: 'ok',
              extraction_note: 'priority_zoe_gemini_flash',
              extracted_at: new Date().toISOString()
          };

          updates.push({
            range: `belege!${String.fromCharCode(65 + ocrTextCol)}${rowIndex}`,
            values: [[text]]
          });
          updates.push({
            range: `belege!${String.fromCharCode(65 + metadataCol)}${rowIndex}`,
            values: [[JSON.stringify(metaObj)]]
          });
      } else {
          console.error(`Gemini error for ${id}: ${JSON.stringify(data)}`);
      }
    } catch (e: any) {
      console.error(`Gemini fetch failed for ${id}: ${e.message}`);
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  }
  
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });
    console.log('Updated sheets with priority OCR.');
  }
}

run().catch(console.error);

```
