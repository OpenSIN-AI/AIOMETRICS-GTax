import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function runAudit() {
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows) return;
  const headers = rows[0];
  
  const h = (name: string) => headers.indexOf(name);
  const nameCol = h('dateiname_original');
  const typeCol = h('belegart');
  const bruttoCol = h('brutto_gesamt');
  const lieferantCol = h('lieferant');
  const kundeCol = h('kunde');
  const textCol = h('extracted_text');
  const ocrCol = h('ocr_text');
  
  const zoeInvoices: any[] = [];
  
  for (let i=1; i<rows.length; i++) {
    const row = rows[i];
    const n = (row[nameCol] || '').toLowerCase();
    const l = (row[lieferantCol] || '').toLowerCase();
    const k = (row[kundeCol] || '').toLowerCase();
    const txt = ((row[textCol] || '') + ' ' + (row[ocrCol] || '')).toLowerCase();
    
    if (n.includes('zoe') || l.includes('zoe') || k.includes('zoe') || txt.includes('zoe solar')) {
      zoeInvoices.push({
        row: i+1,
        name: row[nameCol],
        type: row[typeCol],
        brutto: parseFloat((row[bruttoCol] || '0').replace('.','').replace(',','.')),
        text: txt.substring(0, 200) + '...'
      });
    }
  }
  
  console.log(`Found ${zoeInvoices.length} Zoe Solar documents.`);
  for (const inv of zoeInvoices) {
     console.log(`- ${inv.name} | Type: ${inv.type} | Brutto: ${inv.brutto}`);
  }
}

runAudit().catch(console.error);
