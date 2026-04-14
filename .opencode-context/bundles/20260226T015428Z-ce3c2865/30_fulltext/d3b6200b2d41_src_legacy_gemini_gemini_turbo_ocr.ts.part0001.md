# Context Fulltext

- source_path: src/legacy/gemini/gemini_turbo_ocr.ts
- source_sha256: 6c8296b86786040b980be1341fd1a6619f0243c85459a76f7b4d7c8d4613f091
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = [REDACTED];
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BATCH_SIZE = 5; 

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<{data: string, mime: string} | null> {
    try {
        const fileMeta = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
        const mime = fileMeta.data.mimeType || '';
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(response.data as ArrayBuffer);
        return { data: buffer.toString('base64'), mime };
    } catch (error: any) {
        console.error(`[Download Error] ${fileId}: ${error.message}`);
        return null;
    }
}

async function analyzeWithQwen(base64Data: string, mimeType: string): Promise<string> {
    const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
    const payload = {
        "model": "qwen/qwen3.5-397b-a17b",
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "OCR TASK: Extract all text from this receipt. Return ONLY the raw text content." },
                    { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${base64Data}` } }
                ]
            }
        ],
        "max_tokens": [REDACTED]
        "temperature": 0.1,
        "top_p": 0.95,
        "stream": false
    };

    const response = await fetch(invokeUrl, {
        method: 'POST',
        headers: {
            "Authorization": [REDACTED]
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        // Fallback: If Qwen rejects image, maybe it's strict on mime types. 
        // But let's report error.
        throw new Error(`Nvidia API Error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

function getColumnLetter(colIndex: number): string {
  let temp, letter = '';
  while (colIndex >= 0) {
    temp = (colIndex) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = Math.floor((colIndex - temp) / 26) - 1;
  }
  return letter;
}

async function runTurboOCR() {
  console.log('--- STARTING GEMINI TURBO OCR (NVIDIA QWEN) ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  const idCol = headers.indexOf('drive_file_id');
  const extTextCol = headers.indexOf('extracted_text');
  const ocrTextCol = headers.indexOf('ocr_text');
  const nameCol = headers.indexOf('dateiname_original');

  const pendingRows: {rowIndex: number, fileId: string, name: string}[] = [];

  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const hasText = (row[extTextCol] || '').length > 10 || (row[ocrTextCol] || '').length > 10;
      if (!hasText && row[idCol]) {
          pendingRows.push({ rowIndex: i + 1, fileId: row[idCol], name: row[nameCol] });
      }
  }

  console.log(`Found ${pendingRows.length} documents missing text.`);
  const batch = pendingRows.slice(0, BATCH_SIZE);
  console.log(`Processing batch of ${batch.length}...`);

  for (const item of batch) {
      console.log(`Processing ${item.name} (${item.fileId})...`);
      try {
          const fileData = await downloadFileBase64(item.fileId);
          if (!fileData) continue;
          
          if (!fileData.mime.startsWith('image/') && fileData.mime !== 'application/pdf') {
              console.log(`Skipping (Unsupported Mime: ${fileData.mime})`);
              continue;
          }

          const text = await analyzeWithQwen(fileData.data, fileData.mime);
          
          if (text) {
              const colLetter = getColumnLetter(extTextCol);
              const updateRange = `Buchhaltung_DB!${colLetter}${item.rowIndex}`;
              
              await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: updateRange,
                  valueInputOption: 'RAW',
                  requestBody: { values: [[text]] }
              });
              console.log(`> Success. Text length: ${text.length}`);
          } else {
              console.log('> Empty response from AI.');
          }
      } catch (err: any) {
          console.error(`> Failed: ${err.message}`);
      }
  }
  
  console.log('--- BATCH COMPLETE ---');
}

runTurboOCR().catch(console.error);

```
