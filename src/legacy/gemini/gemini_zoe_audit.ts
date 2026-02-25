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

async function getMimeType(fileId: string) {
    const file = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
    return file.data.mimeType || '';
}

async function analyzeWithGemini(mime: string, base64: string): Promise<any> {
    const prompt = `You are an accountant. Analyze this invoice. It is an invoice I sent to a customer for solar equipment (0% VAT).
Look for:
1. Total order value (Gesamtauftragswert / Angebotssumme)
2. Invoice value of this document
3. Customer name
4. Payment plan notes
Return strict JSON:
{"totalOrderValue": 0, "thisInvoiceValue": 0, "customerName": "", "missingValue": 0, "notes": ""}`;

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: mime, data: base64 } }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
        }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data: any = await response.json();
    if (data?.error) {
        throw new Error(String(data.error.message || 'Gemini API error'));
    }

    const raw = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    const totalOrderValue = Number(parsed.totalOrderValue || 0);
    const thisInvoiceValue = Number(parsed.thisInvoiceValue || 0);
    return {
        totalOrderValue,
        thisInvoiceValue,
        customerName: String(parsed.customerName || ''),
        missingValue: Number(parsed.missingValue || Math.max(totalOrderValue - thisInvoiceValue, 0)),
        notes: String(parsed.notes || '')
    };
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
    // Only capture actual customer invoices sent to Zoe Solar customers
    if (n.includes('zoe solar') && n.includes('rechnung') && !n.includes('kontoauszug') && !n.includes('werbung') && !n.includes('nutzung')) {
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
     const mime = await getMimeType(inv.fileId);
     if (!mime.includes('pdf') && !mime.includes('image')) continue;
     const b64 = await downloadFileBase64(inv.fileId);
     if (!b64) continue;
     
     try {
         const data = await analyzeWithGemini(mime, b64);
         console.log(data);
         report.push(`- ${inv.name} (Customer: ${data.customerName}): Order Value: ${data.totalOrderValue}, Invoiced here: ${data.thisInvoiceValue}. Missing/Remaining: ${data.missingValue} EUR. Notes: ${data.notes}`);
     } catch (e: any) {
         console.error(`Failed to analyze ${inv.name}: ${e.message}`);
     }
  }
  
  console.log('\n--- FINAL AUDIT REPORT ---');
  console.log(report.join('\n'));
}

runAudit().catch(console.error);
