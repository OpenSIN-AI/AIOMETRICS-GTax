import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const API_KEY = process.env.NVIDIA_API_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function analyzeWithNvidia(text: string): Promise<any> {
    const prompt = `You are an accountant. Analyze this invoice text (Zoe Solar).
    Extract:
    1. Total Order Value (Gesamtauftragswert / Angebotssumme).
    2. The amount invoiced in THIS specific document.
    3. Customer Name.
    4. Notes on payment plan (e.g. 1. Abschlag).
    
    Text:
    """${text.substring(0, 10000)}"""
    
    Output JSON strictly: {"totalOrderValue": number, "thisInvoiceValue": number, "customerName": "string", "notes": "string"}. Use 0 if missing.`;

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "meta/llama-3.1-405b-instruct",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 512,
            })
        });

        if (!response.ok) throw new Error(response.statusText);
        const data: any = await response.json();
        const content = data.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch (e) {
        return { totalOrderValue: 0, thisInvoiceValue: 0, customerName: "Unknown", notes: "Error" };
    }
}

async function runAudit() {
  console.log('--- STARTING ZOE SOLAR AUDIT V2 (JOINED DATA) ---');
  
  const dbRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Buchhaltung_DB!A1:AZ' });
  const dbRows = dbRes.data.values || [];
  const dbHeaders = dbRows[0];
  const dbIdCol = dbHeaders.indexOf('drive_file_id');
  const nameCol = dbHeaders.indexOf('dateiname_original');

  const belegeRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'belege!A1:AZ' });
  const belegeRows = belegeRes.data.values || [];
  const belegeHeaders = belegeRows[0];
  const bIdCol = belegeHeaders.indexOf('drive_file_id');
  const bExtTextCol = belegeHeaders.indexOf('extracted_text');
  const bOcrTextCol = belegeHeaders.indexOf('ocr_text');

  const textMap = new Map<string, string>();
  for (let i = 1; i < belegeRows.length; i++) {
      const row = belegeRows[i];
      if (row[bIdCol]) textMap.set(row[bIdCol], (row[bExtTextCol] || '') + ' ' + (row[bOcrTextCol] || ''));
  }

  const zoeInvoices: any[] = [];
  for (let i = 1; i < dbRows.length; i++) {
      const row = dbRows[i];
      const name = (row[nameCol] || '').toLowerCase();
      const text = textMap.get(row[dbIdCol]) || '';
      
      if (name.includes('zoe solar') && name.includes('rechnung') && text.length > 50) {
          zoeInvoices.push({ name: row[nameCol], text });
      }
  }

  console.log(`Found ${zoeInvoices.length} Zoe Solar invoices with text.`);
  const report: string[] = [];

  for (const inv of zoeInvoices) {
      process.stdout.write(`Analyzing ${inv.name}... `);
      const data = await analyzeWithNvidia(inv.text);
      const missing = data.totalOrderValue - data.thisInvoiceValue;
      report.push(`- ${inv.name}\n  Customer: ${data.customerName}\n  Order Total: ${data.totalOrderValue} €\n  This Invoice: ${data.thisInvoiceValue} €\n  Gap: ${missing} €\n  Notes: ${data.notes}`);
      console.log('Done.');
  }

  console.log('\n--- ZOE SOLAR AUDIT REPORT ---');
  console.log(report.join('\n'));
}

runAudit().catch(console.error);
