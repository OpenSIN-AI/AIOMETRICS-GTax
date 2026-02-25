import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY || process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function downloadFileBase64(fileId: string): Promise<string | null> {
    try {
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(response.data as ArrayBuffer);
        return buffer.toString('base64');
    } catch (error: any) {
        console.error(`[Download Error] ${fileId}: ${error.message}`);
        return null;
    }
}

async function getMimeType(fileId: string): Promise<string> {
    const file = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
    return file.data.mimeType || '';
}

async function analyzeWithGemini(mime: string, base64: string): Promise<any> {
    const prompt = `You are an accountant. Analyze this invoice. It is an invoice I sent to a customer for solar equipment. Look for the following numbers:
1. The Total Order Value (Gesamtauftragswert / Angebotssumme).
2. The amount invoiced in THIS specific invoice (Rechnungsbetrag).
3. Any payment plan (Zahlungsplan) showing how much is due at which stage.
Output JSON strictly like this: {"totalOrderValue": 15000, "thisInvoiceValue": 10000, "customerName": "John Doe", "notes": "Zahlung 1 von 3"}. If you cannot find total order value, just put thisInvoiceValue.`;

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: mime, data: base64 } }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    
    const data: any = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const text = data.candidates[0].content.parts[0].text;
    return JSON.parse(text);
}

async function runAudit() {
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows) return;
  const headers = rows[0];
  
  const h = (name: string) => headers.indexOf(name);
  const idCol = h('drive_file_id');
  const nameCol = h('dateiname_original');
  
  const zoeInvoices: any[] = [];
  
  for (let i=1; i<rows.length; i++) {
    const row = rows[i];
    const n = (row[nameCol] || '').toLowerCase();
    
    if (n.includes('zoe solar') && n.includes('rechnung') && !n.includes('kopie') && !n.includes('kontoauszug') && !n.includes('werbung') && !n.includes('nutzung')) {
      zoeInvoices.push({
        fileId: row[idCol],
        name: row[nameCol]
      });
    }
  }
  
  console.log(`Found ${zoeInvoices.length} Zoe Solar invoices to audit.`);
  
  const report: string[] = [];
  
  for (const inv of zoeInvoices) {
     console.log(`Analyzing: ${inv.name}`);
     try {
         const mime = await getMimeType(inv.fileId);
         if (!mime.includes('pdf') && !mime.includes('image')) continue;
         const b64 = await downloadFileBase64(inv.fileId);
         if (!b64) continue;
         
         const data = await analyzeWithGemini(mime, b64);
         const missing = data.totalOrderValue - data.thisInvoiceValue;
         report.push(`- ${inv.name} | Customer: ${data.customerName} | Order Value: ${data.totalOrderValue} EUR | Invoiced: ${data.thisInvoiceValue} EUR | Remaining: ${missing > 0 ? missing : 0} EUR | Notes: ${data.notes}`);
     } catch (e: any) {
         console.error(`Failed to analyze ${inv.name}: ${e.message}`);
     }
  }
  
  console.log('\n--- FINAL ZOE SOLAR AUDIT REPORT ---');
  console.log(report.join('\n'));
}

runAudit().catch(console.error);
