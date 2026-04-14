# Context Fulltext

- source_path: src/orchestrator/micro_tax_category_assign.ts
- source_sha256: b7d36880636c5785b893ec1aea6b11af7548e8f2951db6f64352fa3841597994
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { withPipelineLock } from './pipeline_lock.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const BATCH_SIZE = Number.parseInt(process.env.MICRO_TAX_BATCH || '40', 10);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_TAX_CATEGORY_ASSIGN.md');

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function infer(text: string): { belegart: string; steuerkategorie: string } {
  const t = normalize(text);
  const owner = /zoe solar|jeremy schulze/.test(t);
  const invoice = /rechnung|abschlagsrechnung|schlussrechnung|teilrechnung|invoice/.test(t);
  const privateMarkers = /lidl|rewe|edeka|flink|wolt|lieferando|netflix|apotheke|tierfutter|drogerie|lebensmittel|zigarette|tabak|bier/.test(t);
  const fuel = /kraftstoff|benzin|diesel|tankstelle|super e5|super e10/.test(t);
  const material = /modul|wechselrichter|pv-anlage|solarmodul|montage|kabel|schraube|baumarkt|ob[i1]|ecoflow/.test(t);
  const telco = /ionos|1&1|telekom|vodafone|hosting|domain|adobe|apple|icloud/.test(t);
  const insurance = /versicherung|hdi|arag/.test(t);
  const miete = /miete|hausverwaltung/.test(t);
  const strom = /vattenfall|strom/.test(t);

  if (owner && invoice) {
    if (/0\s?%|steuerfrei|umsatzsteuerfrei/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 0% PV' };
    if (/19\s?%/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 19%' };
    if (/7\s?%/.test(t)) return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen 7%' };
    return { belegart: 'Einnahme', steuerkategorie: 'Einnahmen' };
  }
  if (privateMarkers && !fuel) return { belegart: 'Ausgabe', steuerkategorie: 'Privat/Nicht abzugsfähig' };
  if (fuel) return { belegart: 'Ausgabe', steuerkategorie: 'Kraftstoff/Benzin' };
  if (material) return { belegart: 'Ausgabe', steuerkategorie: 'Material/PV' };
  if (telco) return { belegart: 'Ausgabe', steuerkategorie: 'Telekommunikation/IT' };
  if (insurance) return { belegart: 'Ausgabe', steuerkategorie: 'Versicherung' };
  if (miete) return { belegart: 'Ausgabe', steuerkategorie: 'Miete' };
  if (strom) return { belegart: 'Ausgabe', steuerkategorie: 'Strom/Energie' };
  return { belegart: 'Ausgabe', steuerkategorie: 'Sonstige Ausgaben' };
}

function colLetter(colIndex0: number): string {
  let n = colIndex0 + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function readSheet(tab: string): Promise<string[][]> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:AZ`
  });
  return (r.data.values || []) as string[][];
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');

  const [db, belege] = await Promise.all([readSheet('Buchhaltung_DB'), readSheet('belege')]);
  if (db.length <= 1) {
    console.log(JSON.stringify({ status: 'ok', processed: 0, reason: 'empty_db' }, null, 2));
    return;
  }
  const h = db[0];
  const hb = belege[0] || [];
  const dIdx = (name: string) => h.indexOf(name);
  const bIdx = (name: string) => hb.indexOf(name);

  const belegeById = new Map<string, string[]>();
  for (let i = 1; i < belege.length; i++) {
    const row = belege[i];
    const id = String(row[bIdx('drive_file_id')] || '').trim();
    if (id) belegeById.set(id, row);
  }

  const idxDrive = dIdx('drive_file_id');
  const idxName = dIdx('dateiname_original');
  const idxBelegart = dIdx('belegart');
  const idxTax = dIdx('steuerkategorie');
  const idxStatus = dIdx('status');
  if (idxDrive < 0 || idxTax < 0 || idxBelegart < 0) throw new Error('Buchhaltung_DB headers missing');

  const updates: Array<{ range: string; values: string[][] }> = [];
  const processed: Array<{ row: number; driveId: string; belegart: string; steuerkategorie: string }> = [];

  for (let i = 1; i < db.length; i++) {
    if (processed.length >= BATCH_SIZE) break;
    const row = db[i];
    const driveId = String(row[idxDrive] || '').trim();
    if (!driveId) continue;
    const existingTax = String(row[idxTax] || '').trim();
    const existingType = String(row[idxBelegart] || '').trim();
    const needs = !existingTax || existingTax === 'Unklar' || existingTax === 'Sonstige Ausgaben' || !existingType || existingType === 'Unklar';
    if (!needs) continue;

    const b = belegeById.get(driveId) || [];
    const text = [
      row[idxName] || '',
      b[bIdx('original_name')] || '',
      b[bIdx('extracted_text')] || '',
      b[bIdx('ocr_text')] || ''
    ].join('\n');
    const r = infer(text);
    const rowNum = i + 1;
    updates.push({ range: `Buchhaltung_DB!${colLetter(idxBelegart)}${rowNum}`, values: [[r.belegart]] });
    updates.push({ range: `Buchhaltung_DB!${colLetter(idxTax)}${rowNum}`, values: [[r.steuerkategorie]] });
    if (idxStatus >= 0) updates.push({ range: `Buchhaltung_DB!${colLetter(idxStatus)}${rowNum}`, values: [['classified']] });
    processed.push({ row: rowNum, driveId, belegart: r.belegart, steuerkategorie: r.steuerkategorie });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
    });
  }

  const lines: string[] = [];
  lines.push('# MICRO Tax Category Assign');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Processed: ${processed.length}`);
  lines.push('');
  lines.push('| row | drive_file_id | belegart | steuerkategorie |');
  lines.push('|---|---|---|---|');
  for (const p of processed) lines.push(`| ${p.row} | ${p.driveId} | ${p.belegart} | ${p.steuerkategorie} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    processed: processed.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

withPipelineLock('micro_tax_category_assign', main).catch((e) => {
  console.error(e);
  process.exit(1);
});

```
