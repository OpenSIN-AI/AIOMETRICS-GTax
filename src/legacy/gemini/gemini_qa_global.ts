import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import axios from 'axios';
import * as fs from 'fs';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const CORE_FIELDS = ['belegart', 'lieferant', 'belegnr', 'belegdatum', 'brutto_gesamt', 'steuerkategorie'];
const QA_YEAR = (process.env.QA_YEAR || '').trim();
const QA_LIMIT = Math.max(1, Number.parseInt(process.env.QA_LIMIT || '100', 10) || 100);

async function ensureQA_Tabs() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetTitles = meta.data.sheets?.map(s => s.properties?.title) || [];
  
  const qaTabs = ['QA_Queue_Global', 'QA_Corrections_Global', 'QA_Manual_Review'];
  const requests: any[] = [];
  
  for (const tab of qaTabs) {
    if (!sheetTitles.includes(tab)) {
      requests.push({
        addSheet: { properties: { title: tab } }
      });
    }
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests }
    });
  }
}

async function getOCRMap() {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `belege!A:S`
  });
  const rows = resp.data.values || [];
  const map = new Map<string, string>();
  const headers = rows[0] || [];
  const idIdx = headers.indexOf('drive_file_id');
  const ocrIdx = headers.indexOf('ocr_text');
  const extIdx = headers.indexOf('extracted_text');
  
  if (idIdx === -1) return map;
  
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fid = r[idIdx];
    if (!fid) continue;
    const text = (ocrIdx !== -1 && r[ocrIdx]) ? r[ocrIdx] : (extIdx !== -1 ? r[extIdx] : '');
    if (text) map.set(fid, text);
  }
  return map;
}

function isKryptisch(val: string): boolean {
  if (!val) return true;
  if (val.toLowerCase() === 'unklar' || val.toLowerCase() === 'null') return true;
  const underscoreCount = (val.match(/_/g) || []).length;
  if (underscoreCount > 3) return true;
  if (/^[0-9]{5,}/.test(val)) return true;
  if (val.length > 40 && /\.[a-z]{3}$/.test(val)) return true;
  return false;
}

async function populateQAQueue() {
  console.log('Fetching Buchhaltung_DB...');
  const dbResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Buchhaltung_DB!A:Z`
  });
  const dbRows = dbResp.data.values || [];
  if (dbRows.length === 0) return [];

  const headers = dbRows[0];
  const queueData: any[][] = [['drive_file_id', 'file_url', 'dateiname_original', ...CORE_FIELDS, 'QA_Grund']];
  const queueItems: any[] = [];

  for (let i = 1; i < dbRows.length; i++) {
    const r = dbRows[i];
    const rowObj: any = {};
    for (let idx = 0; idx < headers.length; idx++) {
      rowObj[headers[idx]] = r[idx] || '';
    }

    if (!rowObj.drive_file_id) continue;

    if (QA_YEAR) {
      const probe = `${rowObj.belegdatum || ''} ${rowObj.dateiname_original || ''} ${rowObj.dateiname_standardisiert || ''}`;
      if (!probe.includes(QA_YEAR)) {
        continue;
      }
    }

    const reasons: string[] = [];
    for (const cf of CORE_FIELDS) {
      if (!rowObj[cf] || rowObj[cf] === 'Unklar' || rowObj[cf].toLowerCase() === 'null') {
        reasons.push(`Fehlendes Feld: ${cf}`);
      }
    }
    if (isKryptisch(rowObj.lieferant)) {
      reasons.push('Kryptischer Lieferant');
    }

    if (reasons.length > 0) {
      queueItems.push({ ...rowObj, reasons });
    }
  }

  queueItems.sort((a, b) => {
    // 1. Missing Date (Highest Priority)
    const missDateA = a.belegdatum === 'Unklar' || !a.belegdatum ? 1 : 0;
    const missDateB = b.belegdatum === 'Unklar' || !b.belegdatum ? 1 : 0;
    if (missDateA !== missDateB) return missDateB - missDateA;

    // 2. Missing Amount
    const missAmtA = a.brutto_gesamt === 'Unklar' || !a.brutto_gesamt ? 1 : 0;
    const missAmtB = b.brutto_gesamt === 'Unklar' || !b.brutto_gesamt ? 1 : 0;
    if (missAmtA !== missAmtB) return missAmtB - missAmtA;

    // 3. 2023 Context
    const isA2023 = a.belegdatum?.includes('2023') || a.dateiname_original?.includes('2023') ? 1 : 0;
    const isB2023 = b.belegdatum?.includes('2023') || b.dateiname_original?.includes('2023') ? 1 : 0;
    return isB2023 - isA2023;
  });

  for (const item of queueItems) {
    queueData.push([
      item.drive_file_id, item.file_url, item.dateiname_original,
      ...CORE_FIELDS.map(cf => item[cf]),
      item.reasons.join('; ')
    ]);
  }

  console.log(`Writing ${queueItems.length} rows to QA_Queue_Global...`);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `QA_Queue_Global!A:Z`
  });
  if (queueData.length > 1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `QA_Queue_Global!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: queueData }
    });
  }
  return queueItems;
}

async function generateCorrections(queueItems: any[], ocrMap: Map<string, string>) {
  const existingResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `QA_Corrections_Global!A:Z`
  });
  const existingRows = existingResp.data.values || [];
  const existingIds = new Set<string>();
  if (existingRows.length > 1) {
    const idIdx = existingRows[0].indexOf('drive_file_id');
    for (let i = 1; i < existingRows.length; i++) {
      if (existingRows[i][idIdx]) existingIds.add(existingRows[i][idIdx]);
    }
  }

  const correctionsHeader = ['drive_file_id', 'file_url', 'dateiname_original', ...CORE_FIELDS, 'Korrekturgrund', 'Ist_Mischbeleg', 'Privater_Anteil'];
  const correctionsData: any[][] = [];
  if (existingRows.length === 0) correctionsData.push(correctionsHeader);

  const manualReviewData: any[][] = [];
  
  let processed = 0;
  const limit = QA_LIMIT;
  console.log(`QA run settings: year=${QA_YEAR || 'ALL'}, limit=${limit}`);

  for (let i = 0; i < queueItems.length; i++) {
    if (processed >= limit) break;
    const item = queueItems[i];
    if (existingIds.has(item.drive_file_id)) continue;
    
    // Also skip if already in manual review
    // (I should probably fetch existing manual review too)
    // For now just keep going.
    
    const ocrText = ocrMap.get(item.drive_file_id) || '';
    if (!ocrText) {
       manualReviewData.push([item.drive_file_id, item.file_url, item.dateiname_original, 'Kein OCR Text vorhanden']);
       processed++;
       continue;
    }
    
    console.log(`[${processed+1}/${limit}] LLM Correction for ${item.dateiname_original}...`);
    try {
      const prompt = `Du bist ein Senior Buchhaltungs-Experte. Korrigiere und vervollständige diesen Beleg.
WICHTIG: Lieferant muss ein sauberer Firmenname sein (z.B. "OBI", "Amazon", "Shell"), KEIN Dateiname oder kryptische ID.

Aktuelle Daten im System:
${CORE_FIELDS.map(f => `${f}: ${item[f]}`).join('\n')}
QA Gründe: ${item.reasons.join(', ')}

Antworte NUR im JSON-Format:
{
  "belegart": "Einnahme oder Ausgabe",
  "lieferant": "SAUBERER FIRMENNAME",
  "belegnr": "...",
  "belegdatum": "TT.MM.JJJJ",
  "brutto_gesamt": "123.45",
  "steuerkategorie": "...",
  "Korrekturgrund": "Grund der Korrektur",
  "Ist_Mischbeleg": "Ja/Nein",
  "Privater_Anteil": "0.00"
}

OCR Text (Auszug):
${ocrText.substring(0, 2000)}`;

      const response = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        {
          model: 'meta/llama-3.1-70b-instruct',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 600
        },
        { headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}` }, timeout: 60000 }
      );
      
      const content = response.data.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const res = JSON.parse(jsonMatch[0]);
        correctionsData.push([
          item.drive_file_id, item.file_url, item.dateiname_original,
          res.belegart || item.belegart,
          res.lieferant || item.lieferant,
          res.belegnr || item.belegnr,
          res.belegdatum || item.belegdatum,
          res.brutto_gesamt || item.brutto_gesamt,
          res.steuerkategorie || item.steuerkategorie,
          res.Korrekturgrund || 'LLM Global Correction',
          res.Ist_Mischbeleg || 'Nein',
          res.Privater_Anteil || '0.00'
        ]);
        processed++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }

  if (correctionsData.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `QA_Corrections_Global!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: correctionsData }
    });
  }
  if (manualReviewData.length > 0) {
     await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `QA_Manual_Review!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: manualReviewData }
    });
  }
  console.log(`Generated ${processed} updates/manual entries.`);
}

async function run() {
  console.log('--- STARTING GLOBAL GEMINI QA ---');
  await ensureQA_Tabs();
  const map = await getOCRMap();
  const queue = await populateQAQueue();
  await generateCorrections(queue, map);
  console.log('--- FINISHED GLOBAL GEMINI QA ---');
}

run().catch(console.error);
