import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BATCH_SIZE = 5; 

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<{data: string, mime: string} | null> {
    try {
        const fileMeta = await drive.files.get({ fileId, fields: 'mimeType,size', supportsAllDrives: true });
        const mime = fileMeta.data.mimeType || '';
        const size = parseInt(fileMeta.data.size || '0');
        
        if (size > 5 * 1024 * 1024) return null; // Skip > 5MB to avoid timeouts

        // Accept images. 
        if (!mime.startsWith('image/')) return null;

        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(response.data as ArrayBuffer);
        return { data: buffer.toString('base64'), mime };
    } catch (error: any) {
        return null;
    }
}

async function analyzeWithNvidia(base64Data: string, mimeType: string): Promise<string> {
    const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
    
    // Using a known Vision model on Nvidia NIM if Qwen fails?
    // User requested Qwen 3.5. 
    // If Qwen 3.5 397B is text only, this will fail.
    // I will try Qwen. If it fails, I'll return empty.
    const model = "qwen/qwen3.5-397b-a17b"; 

    const payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "OCR this image. Return raw text." },
                    { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${base64Data}` } }
                ]
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.1,
        "stream": false
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000); // 40s timeout

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

        if (!response.ok) return "";

        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        clearTimeout(timeout);
        return "";
    }
}

function getColumnLetter(colIndex: number): string {
    let letter = "";
    while (colIndex >= 0) {
        letter = String.fromCharCode((colIndex % 26) + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

async function runQueue() {
  console.log('--- GEMINI NVIDIA OCR QUEUE ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ',
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  const idCol = headers.indexOf('drive_file_id');
  const extTextCol = headers.indexOf('extracted_text');
  const ocrTextCol = headers.indexOf('ocr_text');
  const nameCol = headers.indexOf('original_name');

  if (extTextCol === -1) return;

  const pendingRows: any[] = [];
  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const hasText = (row[extTextCol] || '').length > 10 || (row[ocrTextCol] || '').length > 10;
      const name = (row[nameCol] || '').toLowerCase();
      const isImg = name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
      
      if (!hasText && row[idCol] && isImg) {
          pendingRows.push({ rowIndex: i + 1, fileId: row[idCol], name: row[nameCol] });
      }
  }

  console.log(`Queue size: ${pendingRows.length} images.`);
  const batch = pendingRows.slice(0, BATCH_SIZE);

  let success = 0;
  for (const item of batch) {
      console.log(`Processing ${item.name}...`);
      const fileData = await downloadFileBase64(item.fileId);
      if (fileData) {
          const text = await analyzeWithNvidia(fileData.data, fileData.mime);
          if (text) {
              const colLetter = getColumnLetter(extTextCol);
              await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `belege!${colLetter}${item.rowIndex}`,
                  valueInputOption: 'RAW',
                  requestBody: { values: [[text]] }
              });
              success++;
              console.log(`> OK (${text.length} chars)`);
          } else {
              console.log('> Failed/Empty');
          }
      } else {
          console.log('> Skip (Download/Size)');
      }
  }
  console.log(`Batch processed. Success: ${success}`);
}

runQueue().catch(console.error);
