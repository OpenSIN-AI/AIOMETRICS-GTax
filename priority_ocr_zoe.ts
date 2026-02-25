import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

dotenv.config();

const API_KEY = (process.env.NVIDIA_API_KEY || '').trim();
const SPREADSHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

const FILE_IDS = [
  '1BfR5sxx9kXlUbEdK6OeGAy-kUI72Y5p3',
  '1hV_mZY4LQlRTbHMfJhBn8avCgEeS3NgP'
];

async function maybePrepareImage(imagePath: string): Promise<{ path: string; cleanup: boolean }> {
  const maxDim = 1800;
  try {
    const stats = fs.statSync(imagePath);
    if (stats.size <= 2000000) {
      return { path: imagePath, cleanup: false };
    }
    const outPath = path.join(
      path.dirname(imagePath),
      `${path.basename(imagePath, path.extname(imagePath))}_small.jpg`
    );
    await execFileAsync('sips', ['-Z', String(maxDim), '-s', 'format', 'jpeg', imagePath, '--out', outPath]);
    return { path: outPath, cleanup: true };
  } catch {
    return { path: imagePath, cleanup: false };
  }
}

async function run() {
  if (!API_KEY) {
    console.error('Missing NVIDIA_API_KEY');
    return;
  }
  console.log('Priority OCR for Zoe Solar Invoices...');
  
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
    if (rowIndex <= 0) {
        console.warn(`ID ${id} not found in sheet`);
        continue;
    }
    
    const tempFile = path.join(os.tmpdir(), `${id}.png`);
    const driveRes = await drive.files.get(
      { fileId: id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(tempFile, Buffer.from(driveRes.data as ArrayBuffer));
    
    const prepared = await maybePrepareImage(tempFile);
    const base64 = fs.readFileSync(prepared.path).toString('base64');
    
    const payload = {
      model: 'qwen/qwen3.5-397b-a17b',
      messages: [
        { role: 'user', content: [
          { type: 'text', text: 'Extrahiere den Text aus dieser Rechnung. Besonders Betrag, Datum und Rechnungsnummer.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
        ]}
      ]
    };
    
    console.log(`Sending to Nvidia API for ${id} (size: ${base64.length})...`);
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.error(`API Error for ${id}: ${response.status} ${errText}`);
        continue;
      }
      
      const data: any = await response.json();
      const text = data.choices[0].message.content;
      console.log(`Extracted text length for ${id}: ${text.length}`);
      
      const metaObj = {
          extraction_status: 'ok',
          extraction_note: 'priority_zoe_ocr',
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
    } catch (e: any) {
      console.error(`Fetch failed for ${id}: ${e.message}`);
    } finally {
      if (prepared.cleanup && fs.existsSync(prepared.path)) fs.unlinkSync(prepared.path);
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
