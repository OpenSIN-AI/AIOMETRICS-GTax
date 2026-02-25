import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function runCategorization() {
  console.log('--- STARTING TAX CATEGORIZATION ---');
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });
  
  const rows = res.data.values || [];
  const headers = rows[0];
  
  const typeCol = headers.indexOf('belegart');
  const catCol = headers.indexOf('steuerkategorie');
  const mwst19Col = headers.indexOf('mwst_19_betrag');
  const mwst0Col = headers.indexOf('mwst_0_betrag');
  const lieferantCol = headers.indexOf('lieferant');
  const textCol = headers.indexOf('extracted_text');
  const nameCol = headers.indexOf('dateiname_original');

  if (catCol === -1) {
      console.error("Column 'steuerkategorie' not found.");
      return;
  }

  const updates: any[] = [];
  let count = 0;

  // Keywords
  const fuelKeywords = ['shell', 'aral', 'esso', 'total', 'jet', 'hem', 'agip', 'tamoil', 'star', 'omv', 'benzin', 'diesel', 'tankstelle'];
  const materialKeywords = ['modul', 'kabel', 'stecker', 'wechselrichter', 'dachhaken', 'schiene', 'schraube', 'klemme', 'solar', 'mc4', 'unterkonstruktion'];

  for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const type = (row[typeCol] || '').toLowerCase();
      const currentCat = row[catCol] || '';
      
      // If category is already set and valid, maybe skip? 
      // User said "prüft und legt fest". Let's overwrite/ensure correctness.
      
      let newCat = 'Sonstige Ausgaben'; // Default for expenses
      
      const lieferant = (row[lieferantCol] || '').toLowerCase();
      const text = (row[textCol] || '').toLowerCase();
      const name = (row[nameCol] || '').toLowerCase();
      const content = lieferant + ' ' + text + ' ' + name;

      if (type === 'einnahme') {
          const m19 = parseFloat((row[mwst19Col] || '0').replace(',', '.'));
          if (m19 > 0) {
              newCat = 'Einnahmen (19%)';
          } else {
              newCat = 'Photovoltaik (0%)';
          }
      } else if (type === 'ausgabe') {
          if (fuelKeywords.some(k => content.includes(k))) {
              newCat = 'Kraftstoff/Benzin';
          } else if (materialKeywords.some(k => content.includes(k))) {
              newCat = 'Material/Waren';
          } else {
              newCat = 'Sonstige Ausgaben';
          }
      } else {
          // Unklar type
          continue; 
      }

      if (newCat !== currentCat) {
          // A = 0. catCol index needs conversion to A1 notation.
          const colLetter = getColumnLetter(catCol);
          updates.push({
              range: `Buchhaltung_DB!${colLetter}${i + 1}`,
              values: [[newCat]]
          });
          count++;
      }
  }

  if (updates.length > 0) {
      console.log(`Updating ${updates.length} categories...`);
      // Batch update in chunks to avoid payload limits
      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              requestBody: {
                  valueInputOption: 'RAW',
                  data: chunk
              }
          });
      }
      console.log('Categories updated.');
  } else {
      console.log('No category updates needed.');
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

runCategorization().catch(console.error);
