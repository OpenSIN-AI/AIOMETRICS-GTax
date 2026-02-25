import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BATCH_SIZE = 10; 

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<{data: string, mime: string} | null> {
    try {
        const fileMeta = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
        const mime = fileMeta.data.mimeType || '';
        
        // STRICTLY IMAGES ONLY
        if (!mime.startsWith('image/')) return null;

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
                    { "type": "text", "text": "Extract all text from this receipt image. Return ONLY the raw text." },
                    { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${base64Data}` } }
                ]
            }
        ],
        "max_tokens": 2048,
        "temperature": 0.1,
        "stream": false
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`API Error ${response.status}: ${err}`);
        }

        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }
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

async function runTurboImages() {
  console.log('--- STARTING GEMINI TURBO OCR (IMAGES ONLY) ---');
  
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

  const pendingRows: any[] = [];
  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const hasText = (row[extTextCol] || '').length > 10 || (row[ocrTextCol] || '').length > 10;
      // Also check name extension to be sure
      const name = (row[nameCol] || '').toLowerCase();
      const isImg = name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.heic');
      
      if (!hasText && row[idCol] && isImg) {
          pendingRows.push({ rowIndex: i + 1, fileId: row[idCol], name: row[nameCol] });
      }
  }

  console.log(`Found ${pendingRows.length} images missing text.`);
  const batch = pendingRows.slice(0, BATCH_SIZE);
  console.log(`Processing batch of ${batch.length}...`);

  let successCount = 0;

  for (const item of batch) {
      console.log(`Processing ${item.name}...`);
      try {
          const fileData = await downloadFileBase64(item.fileId);
          if (!fileData) {
              console.log('Skipping (Not an image or download failed)');
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
              console.log(`> Success! extracted ${text.length} chars.`);
              successCount++;
          } else {
              console.log('> Empty result.');
          }
      } catch (err: any) {
          console.error(`> Failed: ${err.message}`);
      }
  }
  
  console.log(`--- BATCH COMPLETE. Success: ${successCount}/${batch.length} ---`);
}

runTurboImages().catch(console.error);
