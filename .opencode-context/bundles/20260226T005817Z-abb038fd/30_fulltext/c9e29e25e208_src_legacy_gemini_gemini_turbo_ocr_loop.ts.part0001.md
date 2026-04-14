# Context Fulltext

- source_path: src/legacy/gemini/gemini_turbo_ocr_loop.ts
- source_sha256: eefa804bf7c2f15e2368cdba6622fdfbc6952de3f479682778db7434ac63b95a
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = [REDACTED];
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const BATCH_SIZE = 5; 
const TOTAL_LIMIT = 50; // Try to process 50 in one run to stay within timeout limits

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<{data: string, mime: string} | null> {
    try {
        const fileMeta = await drive.files.get({ fileId, fields: 'mimeType,size', supportsAllDrives: true });
        const mime = fileMeta.data.mimeType || '';
        const size = parseInt(fileMeta.data.size || '0');
        
        if (size > 8 * 1024 * 1024) return null; // Skip > 8MB

        // Qwen on Nvidia seems to support images. PDF support is tricky via API usually.
        // Let's stick to images for now.
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

async function analyzeWithQwen(base64Data: string, mimeType: string): Promise<string> {
    const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
    const payload = {
        "model": "qwen/qwen3.5-397b-a17b",
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "OCR TASK: Extract all text from this receipt. Return ONLY the raw text." },
                    { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${base64Data}` } }
                ]
            }
        ],
        "max_tokens": [REDACTED]
        "temperature": 0.1,
        "stream": false
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: {
                "Authorization": [REDACTED]
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

async function runOCR() {
  console.log('--- GEMINI TURBO OCR LOOP ---');
  
  // Fetch DB
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
      const hasText = (row[extTextCol] || '').length > 20 || (row[ocrTextCol] || '').length > 20;
      
      if (!hasText && row[idCol]) {
          pendingRows.push({ rowIndex: i + 1, fileId: row[idCol], name: row[nameCol] });
      }
  }

  console.log(`Remaining missing text: ${pendingRows.length}`);
  
  const processList = pendingRows.slice(0, TOTAL_LIMIT);
  let successCount = 0;

  for (let i = 0; i < processList.length; i += BATCH_SIZE) {
      const chunk = processList.slice(i, i + BATCH_SIZE);
      console.log(`Processing chunk ${i/BATCH_SIZE + 1}...`);
      
      const promises = chunk.map(async (item: any) => {
          try {
              const fileData = await downloadFileBase64(item.fileId);
              if (!fileData) return null;
              
              const text = await analyzeWithQwen(fileData.data, fileData.mime);
              if (text && text.length > 5) {
                  return { rowIndex: item.rowIndex, text };
              }
          } catch (e) {
              console.error(`Err ${item.name}`);
          }
          return null;
      });

      const results = await Promise.all(promises);
      const updates = results.filter(r => r !== null);

      if (updates.length > 0) {
          const colLetter = getColumnLetter(extTextCol);
          // We can't batch update disparate cells easily with values.batchUpdate unless we define ranges carefully.
          // Or we do individual updates. For safety, individual is easier but slower. 
          // Let's try batchUpdate with 'data' array.
          
          const updateData = updates.map((u: any) => ({
              range: `Buchhaltung_DB!${colLetter}${u.rowIndex}`,
              values: [[u.text]]
          }));

          await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              requestBody: {
                  valueInputOption: 'RAW',
                  data: updateData
              }
          });
          successCount += updates.length;
          console.log(`Saved ${updates.length} texts.`);
      }
  }
  
  console.log(`--- LOOP COMPLETE. Processed ${successCount}/${processList.length} successfully. ---`);
}

runOCR().catch(console.error);

```
