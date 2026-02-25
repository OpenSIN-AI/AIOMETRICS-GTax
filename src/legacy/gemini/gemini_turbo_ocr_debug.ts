import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BATCH_SIZE = 3; 

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<{data: string, mime: string, size: number} | null> {
    try {
        const fileMeta = await drive.files.get({ fileId, fields: 'mimeType,size', supportsAllDrives: true });
        const mime = fileMeta.data.mimeType || '';
        const size = parseInt(fileMeta.data.size || '0');
        
        console.log(`Downloading ${fileId} (${size} bytes, ${mime})...`);
        if (size > 10 * 1024 * 1024) { // Skip > 10MB
             console.log("Skipping large file > 10MB");
             return null;
        }

        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(response.data as ArrayBuffer);
        return { data: buffer.toString('base64'), mime, size };
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
                    { "type": "text", "text": "Extract text." }, // Keep prompt short
                    { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${base64Data}` } }
                ]
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.1,
        "stream": false
    };

    console.log("Sending to Nvidia API...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

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
            const errText = await response.text();
            throw new Error(`Status ${response.status}: ${errText.substring(0, 200)}...`);
        }

        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e: any) {
        clearTimeout(timeout);
        throw e;
    }
}

async function runDebug() {
  console.log('--- DEBUG GEMINI TURBO OCR ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  const idCol = headers.indexOf('drive_file_id');
  const extTextCol = headers.indexOf('extracted_text');
  const nameCol = headers.indexOf('dateiname_original');

  const pendingRows: any[] = [];
  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!(row[extTextCol] || '') && row[idCol]) {
          pendingRows.push({ rowIndex: i + 1, fileId: row[idCol], name: row[nameCol] });
      }
  }

  // Randomize batch to avoid sticking on the same broken file
  const start = Math.floor(Math.random() * (pendingRows.length - BATCH_SIZE));
  const batch = pendingRows.slice(start, start + BATCH_SIZE);
  
  console.log(`Processing batch of ${batch.length} (starting at index ${start})...`);

  for (const item of batch) {
      console.log(`\nProcessing ${item.name}...`);
      try {
          const fileData = await downloadFileBase64(item.fileId);
          if (!fileData) continue;
          
          if (!fileData.mime.startsWith('image/') && fileData.mime !== 'application/pdf') {
              console.log(`Skipping Mime: ${fileData.mime}`);
              continue;
          }

          const text = await analyzeWithQwen(fileData.data, fileData.mime);
          console.log(`> Result: ${text.substring(0, 50)}...`);
          
      } catch (err: any) {
          console.error(`> Failed: ${err.message}`);
      }
  }
}

runDebug().catch(console.error);
