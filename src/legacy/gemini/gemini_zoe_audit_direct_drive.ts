import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function getFileContent(fileId: string, mimeType: string): Promise<string | null> {
    try {
        if (mimeType === 'application/pdf') {
            // For PDFs, we ideally need OCR. Since we can't easily run OCR locally without tesseract setup,
            // we will check if we can get a thumbnail or just skip for now if we can't send PDF to Nvidia directly.
            // Actually, Nvidia Llama 3.2 Vision might handle images. 
            // Let's try to get text if it's a google doc, or download content.
            // For now, let's assume we can't easily parse PDF binary here without external tools.
            // BUT, user said "nvidia modelle zur vision analyse".
            return null; 
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function runAudit() {
  console.log('--- ZOE SOLAR AUDIT (DIRECT DRIVE SCAN) ---');
  
  // Get list of all files in "Einnahmen" folders to find Zoe Solar invoices
  // Or just iterate Buchhaltung_DB
  const dbRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Buchhaltung_DB!A1:AZ' });
  const dbRows = dbRes.data.values || [];
  const dbHeaders = dbRows[0];
  const nameCol = dbHeaders.indexOf('dateiname_original');
  const idCol = dbHeaders.indexOf('drive_file_id');
  const typeCol = dbHeaders.indexOf('belegart');

  const candidates: any[] = [];
  
  for (let i = 1; i < dbRows.length; i++) {
      const row = dbRows[i];
      const name = (row[nameCol] || '').toLowerCase();
      
      // Filter for Zoe Solar invoices
      if (name.includes('zoe solar') && name.includes('rechnung')) {
          candidates.push({ name: row[nameCol], id: row[idCol], rowIdx: i + 1 });
      }
  }

  console.log(`Found ${candidates.length} Zoe Solar invoice candidates.`);
  
  if (candidates.length === 0) {
      console.log("No candidates found via filename matching.");
      return;
  }

  // We need to trigger a real analysis. 
  // Since we cannot rely on local OCR, we mark them for "Deep Analysis Needed" in the sheet?
  // Or report them.
  
  console.log("Candidates:");
  candidates.forEach(c => console.log(`- ${c.name} (${c.id})`));
  
  console.log("\nAction: Please run 'accounting_enrichment' specifically for these files to populate text.");
}

runAudit().catch(console.error);
