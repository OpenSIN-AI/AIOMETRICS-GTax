# Context Fulltext

- source_path: src/legacy/gemini/gemini_archive_cleanup.ts
- source_sha256: c2e4b04b1ffec2bb18220c11442bf3340f9efc667f5c39eabfa84f33cc82c4f1
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

const FOLDER_PRIVAT = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const FOLDER_ARCHIV = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const FOLDER_MISSING = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';

async function moveFile(fileId: string, targetFolderId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const previousParents = file.data.parents?.join(',') || '';
    if (previousParents === targetFolderId) {
        console.log(`[ALREADY IN TARGET] ${fileName} (${fileId}) -> ${targetFolderId}`);
        return;
    }
    await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[MOVED] ${fileName} (${fileId}) -> ${targetFolderId}`);
  } catch (err: any) {
    console.error(`[ERROR] moving ${fileName} (${fileId}): ${err.message}`);
  }
}

async function runCleanup() {
  console.log('--- STARTING ARCHIVE CLEANUP ---');
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows || rows.length === 0) {
    console.log('No data found in Buchhaltung_DB');
    return;
  }

  const headers = rows[0];
  const colIndex = (colName: string) => headers.indexOf(colName);
  
  const idCol = colIndex('drive_file_id');
  const nameCol = colIndex('dateiname_original');
  const liferantCol = colIndex('lieferant');
  const categoryCol = colIndex('steuerkategorie');
  const typeCol = colIndex('belegart');
  const notesCol = colIndex('hinweis');
  const extractedTextCol = colIndex('extracted_text');
  const ocrTextCol = colIndex('ocr_text');
  const bruttoCol = colIndex('brutto_gesamt');
  const mwst0Col = colIndex('mwst_0_betrag');
  const mwst19Col = colIndex('mwst_19_betrag');
  const mwst7Col = colIndex('mwst_7_betrag');

  let privatCount = 0;
  let archivCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row[idCol];
    const fileName = row[nameCol] || '';
    const lieferant = (row[liferantCol] || '').toLowerCase();
    const type = (row[typeCol] || '').toLowerCase();
    const text = ((row[extractedTextCol] || '') + ' ' + (row[ocrTextCol] || '')).toLowerCase();
    const nameLower = fileName.toLowerCase();
    
    let targetFolder = '';

    // 1. Privat Belege (Groceries, Rent, Utilities, Delivery, Netflix, Apotheken)
    const privatKeywords = [
        'flink', 'getränke hoffmann', 'getraenke hoffmann', 'lidl', 'rewe', 'edeka', 
        'vattenfall', 'wolt', 'lieferando', 'hdi', 'woolworth', 'netflix', 'apotheke', 
        'miete', 'hausverwaltung', 'rossmann', 'dm-drogerie', 'dm drogerie'
    ];
    
    if (privatKeywords.some(kw => lieferant.includes(kw) || nameLower.includes(kw))) {
        targetFolder = FOLDER_PRIVAT;
    }

    // 6. 0% Ausgaben belege
    if (!targetFolder && type === 'ausgabe') {
        const b = parseFloat(row[bruttoCol]?.replace(',','.') || '0');
        const m0 = parseFloat(row[mwst0Col]?.replace(',','.') || '0');
        const m19 = parseFloat(row[mwst19Col]?.replace(',','.') || '0');
        const m7 = parseFloat(row[mwst7Col]?.replace(',','.') || '0');
        
        // If it's an expense, and 100% of the VAT is 0% (or no 19/7 specified but a brutto exists)
        // Let's rely on OCR or text if it explicitly says 0% VAT. 
        // Or if the brutto > 0 and 19/7 are 0 or empty.
        // Wait, some business expenses from outside EU are 0%. User said: "0% Ausgaben belege wo ich geld zahlte... diese sollen raus"
        if (b > 0 && m19 === 0 && m7 === 0 && (m0 > 0 || (m0 === 0 && text.includes('0%')))) {
            // Let's be careful. Let's just catch obvious ones for now, or everything that has 0% VAT.
            // Actually user explicitly wrote "6 . Ausgaben belege wo ich geld zahlte aber 0% mehrwertsteuer sind in den drive ordner ... (diese sollen raus aus tabellen!)"
            if (m19 === 0 && m7 === 0) {
               targetFolder = FOLDER_PRIVAT; // wait, he said same folder 1Mt2...
            }
        }
    }

    // 8. Archiviert (Behörden, Krankenkassen)
    const archivKeywords = ['finanzamt', 'aok', 'sbk', 'arag'];
    if (!targetFolder && archivKeywords.some(kw => lieferant.includes(kw) || nameLower.includes(kw))) {
        targetFolder = FOLDER_ARCHIV;
    }

    // 7. Ionos / 1&1 Sammelrechnungen / Vertragsübersichten
    if (!targetFolder && (lieferant.includes('ionos') || lieferant.includes('1&1') || nameLower.includes('ionos'))) {
        if (nameLower.includes('übersicht') || nameLower.includes('ubersicht') || nameLower.includes('sammel') || nameLower.includes('vertrag') || 
            text.includes('vertragsübersicht') || text.includes('sammelrechnung')) {
            targetFolder = FOLDER_ARCHIV;
        }
    }

    if (targetFolder) {
        if (targetFolder === FOLDER_PRIVAT) privatCount++;
        if (targetFolder === FOLDER_ARCHIV) archivCount++;
        await moveFile(fileId, targetFolder, fileName);
    }
  }

  console.log(`\n--- CLEANUP COMPLETE ---`);
  console.log(`Moved ${privatCount} files to Privat`);
  console.log(`Moved ${archivCount} files to Archiv`);
}

runCleanup().catch(console.error);

```
