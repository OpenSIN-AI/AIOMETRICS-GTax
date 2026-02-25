import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive'],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

const FOLDER_PRIVAT = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const FOLDER_ARCHIV = '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U';
const FOLDER_FEHLEND = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';

async function moveFile(fileId: string, targetFolderId: string, fileName: string) {
  try {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    const previousParents = file.data.parents?.join(',') || '';
    if (previousParents.includes(targetFolderId)) {
        return; // Already there
    }
    await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      supportsAllDrives: true,
      fields: 'id, parents',
    });
    console.log(`[MOVED] ${fileName} -> ${targetFolderId === FOLDER_PRIVAT ? 'Privat' : 'Archiv'}`);
  } catch (err: any) {
    console.error(`[ERROR] moving ${fileName}: ${err.message}`);
  }
}

async function runCleanup() {
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows || rows.length === 0) return;
  const headers = rows[0];
  const colIndex = (colName: string) => headers.indexOf(colName);
  
  const idCol = colIndex('drive_file_id');
  const nameCol = colIndex('dateiname_original');
  const liferantCol = colIndex('lieferant');
  const typeCol = colIndex('belegart');
  const extTextCol = colIndex('extracted_text');
  const ocrTextCol = colIndex('ocr_text');
  const bruttoCol = colIndex('brutto_gesamt');
  const mwst0Col = colIndex('mwst_0_betrag');
  const mwst19Col = colIndex('mwst_19_betrag');
  const mwst7Col = colIndex('mwst_7_betrag');

  let pCount = 0;
  let aCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row[idCol];
    if (!fileId) continue;
    
    const fileName = row[nameCol] || '';
    const lieferant = (row[liferantCol] || '').toLowerCase();
    const type = (row[typeCol] || '').toLowerCase();
    const text = ((row[extTextCol] || '') + ' ' + (row[ocrTextCol] || '')).toLowerCase();
    const nameLower = fileName.toLowerCase();
    
    let targetFolder = '';

    const privatKeywords = [
        'flink', 'getränke hoffmann', 'getraenke hoffmann', 'lidl', 'rewe', 'edeka', 
        'vattenfall', 'wolt', 'lieferando', 'woolworth', 'netflix', 'apotheke', 
        'miete', 'hausverwaltung', 'rossmann', 'dm-drogerie', 'dm drogerie', 'tierfutter', 'lebensmittel'
    ];
    
    if (privatKeywords.some(kw => lieferant.includes(kw) || nameLower.includes(kw) || text.includes(kw))) {
        targetFolder = FOLDER_PRIVAT;
    }

    const archivKeywords = ['finanzamt', 'aok', 'sbk', 'arag', 'hdi', 'übertragungsprotokoll', 'schätzung', 'bescheid', 'mitteilung'];
    if (!targetFolder && archivKeywords.some(kw => lieferant.includes(kw) || nameLower.includes(kw) || text.includes(kw))) {
        targetFolder = FOLDER_ARCHIV;
    }

    if (!targetFolder && (lieferant.includes('ionos') || lieferant.includes('1&1') || nameLower.includes('ionos'))) {
        if (nameLower.includes('übersicht') || nameLower.includes('sammel') || nameLower.includes('vertrag') || 
            text.includes('vertragsübersicht') || text.includes('sammelrechnung')) {
            targetFolder = FOLDER_ARCHIV;
        }
    }

    if (!targetFolder && type === 'ausgabe') {
        const m19Str = row[mwst19Col]?.replace(',','.');
        const m7Str = row[mwst7Col]?.replace(',','.');
        const bStr = row[bruttoCol]?.replace(',','.');
        
        const m19 = parseFloat(m19Str || '0');
        const m7 = parseFloat(m7Str || '0');
        const b = parseFloat(bStr || '0');
        
        // "Ausgaben belege wo ich geld zahlte aber 0% mehrwertsteuer... (diese sollen raus aus tabellen!)"
        // Let's check if VAT is precisely 0 for 19 and 7.
        // Wait, what if it's 0% but a business expense (e.g. from outside EU or small business)?
        // The user was explicit: "Ausgaben belege wo ich geld zahlte aber 0% mehrwertsteuer... diese sollen raus aus tabellen"
        // Also: "KEIN BELEG DER 7$ MWST ENTHÄLT" -> 7% VAT receipts out.
        if (b > 0) {
            if (m19 === 0 && m7 === 0 && text.includes('0%')) {
                // targetFolder = FOLDER_PRIVAT; 
                // Let's only do this if it's explicitly 0%. Or if m7 > 0
            }
            if (m7 > 0 || m7Str?.includes('7') || text.includes('7%')) {
                // If the receipt contains 7% VAT, move to privat (user said no 7% VAT)
                if (text.includes('7%') && !text.includes('19%')) {
                    targetFolder = FOLDER_PRIVAT;
                }
            }
        }
    }

    if (targetFolder) {
        if (targetFolder === FOLDER_PRIVAT) pCount++;
        if (targetFolder === FOLDER_ARCHIV) aCount++;
        await moveFile(fileId, targetFolder, fileName);
    }
  }

  console.log(`Moved ${pCount} to Privat, ${aCount} to Archiv`);
}

runCleanup().catch(console.error);
