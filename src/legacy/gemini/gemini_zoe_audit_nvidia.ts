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
    const prompt = `You are an accountant. Analyze this extracted text from an invoice I sent to a customer (Zoe Solar). 
    I need to check if the total order value matches the invoices.
    Look for:
    1. Total Order Value (Gesamtauftragswert / Angebotssumme).
    2. The amount invoiced in THIS specific document.
    3. Payment terms (e.g. 1. Abschlag, Schlussrechnung).
    
    Invoice Text:
    """${text.substring(0, 15000)}"""
    
    Output JSON strictly: {"totalOrderValue": number, "thisInvoiceValue": number, "customerName": "string", "notes": "string"}. 
    If values are missing, use 0.`;

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "meta/llama-3.1-405b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            top_p: 0.7,
            max_tokens: 1024,
        })
    });

    if (!response.ok) {
        throw new Error(`Nvidia API Error: ${response.statusText}`);
    }

    const data: any = await response.json();
    const content = data.choices[0].message.content;
    
    try {
        // Extract JSON from markdown code block if present
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(content);
    } catch (e) {
        console.error("Failed to parse JSON:", content);
        return { totalOrderValue: 0, thisInvoiceValue: 0, customerName: "Unknown", notes: "Parse Error" };
    }
}

async function runAudit() {
  console.log('--- STARTING ZOE SOLAR AUDIT (GLOBAL) ---');
  
  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Buchhaltung_DB!A1:AZ',
  });

  const rows = meta.data.values;
  if (!rows) return;
  const headers = rows[0];
  
  const h = (name: string) => headers.indexOf(name);
  const nameCol = h('dateiname_original');
  const textCol = h('extracted_text');
  const ocrCol = h('ocr_text');
  
  const zoeInvoices: any[] = [];
  
  for (let i=1; i<rows.length; i++) {
    const row = rows[i];
    const n = (row[nameCol] || '').toLowerCase();
    const t = ((row[textCol] || '') + ' ' + (row[ocrCol] || ''));
    
    if (n.includes('zoe solar') && n.includes('rechnung') && t.length > 50) {
      zoeInvoices.push({
        name: row[nameCol],
        text: t
      });
    }
  }
  
  console.log(`Found ${zoeInvoices.length} Zoe Solar invoices with text content.`);
  
  const report: string[] = [];
  
  for (const inv of zoeInvoices) {
     process.stdout.write(`Analyzing ${inv.name}... `);
     try {
         const data = await analyzeWithNvidia(inv.text);
         const missing = data.totalOrderValue - data.thisInvoiceValue;
         report.push(`- ${inv.name}\n  Customer: ${data.customerName}\n  Order Total: ${data.totalOrderValue} €\n  This Invoice: ${data.thisInvoiceValue} €\n  Gap: ${missing} €\n  Notes: ${data.notes}`);
         console.log('Done.');
     } catch (e: any) {
         console.log('Failed.');
         console.error(`Error: ${e.message}`);
     }
  }
  
  console.log('\n--- ZOE SOLAR AUDIT REPORT ---');
  console.log(report.join('\n'));
}

runAudit().catch(console.error);
