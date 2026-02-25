import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

interface RowObj { [k: string]: string; }

const REPORT_PATH = path.join(process.cwd(), 'docs', 'TANKSTELLEN_SPLIT_2023.md');
const FUEL_KEYWORDS = ['kraftstoff', 'benzin', 'diesel', 'tankstelle', 'super e5', 'super e10', 'aral', 'shell', 'esso', 'total'];
const PRIVATE_ITEM_KEYWORDS = ['zigarette', 'tabak', 'bier', 'snack', 'drogerie', 'lebensmittel', 'cappuccino', 'lucky strike', 'lucky red', 'lucky straight'];

function parseAmount(value: string): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') && clean.includes('.')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(',', '.');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function toRows(values: string[][]): RowObj[] {
  if (values.length <= 1) return [];
  const headers = values[0].map((h) => String(h || '').trim());
  return values.slice(1).map((row) => {
    const out: RowObj = {};
    headers.forEach((h, i) => { out[h] = String(row[i] || ''); });
    return out;
  });
}

function probe(...parts: string[]): string {
  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID as string;
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID');
  const auth = new JWT({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [expenseRes, dbRes, belegeRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Ausgaben_2023!A1:AZ' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Buchhaltung_DB!A1:AZ' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'belege!A1:AZ' })
  ]);

  const expenseRows = toRows((expenseRes.data.values || []) as string[][]);
  const dbRows = toRows((dbRes.data.values || []) as string[][]);
  const belegeRows = toRows((belegeRes.data.values || []) as string[][]);

  const dbById = new Map<string, RowObj>();
  for (const r of dbRows) {
    if (r.drive_file_id) dbById.set(r.drive_file_id, r);
  }
  const belegeById = new Map<string, RowObj>();
  for (const r of belegeRows) {
    if (r.drive_file_id) belegeById.set(r.drive_file_id, r);
  }

  const hits: Array<{
    date: string;
    supplier: string;
    name: string;
    fileId: string;
    gross: number;
    businessVat: number;
    privateVat: number;
    mixed: boolean;
    hint: string;
    fileUrl: string;
  }> = [];

  for (const r of expenseRows) {
    const fileId = r.drive_file_id || '';
    if (!fileId) continue;
    const db = dbById.get(fileId) || {};
    const b = belegeById.get(fileId) || {};

    const p = probe(
      r.Lieferant || '',
      r.Dateiname || '',
      r.Kategorie || '',
      db.lieferant || '',
      db.steuerkategorie || '',
      db.extracted_text || '',
      db.ocr_text || '',
      b.extracted_text || '',
      b.ocr_text || '',
      b.original_name || ''
    );
    const isFuel = FUEL_KEYWORDS.some((k) => p.includes(k));
    if (!isFuel) continue;

    const hasPrivate = PRIVATE_ITEM_KEYWORDS.some((k) => p.includes(k));
    const businessVat = parseAmount(db.geschaeftliche_mwst || r.geschaeftliche_mwst || '');
    const privateVat = parseAmount(db.private_mwst || r.private_mwst || '');
    const gross = parseAmount(r.Betrag_Brutto || db.brutto_gesamt || '');
    const hint = hasPrivate
      ? 'MIXED: Kraftstoff + private Positionen erkannt; private/betriebliche Anteile prüfen'
      : 'Kraftstoffbeleg ohne private Marker';

    hits.push({
      date: r.Datum || db.belegdatum || '',
      supplier: r.Lieferant || db.lieferant || '',
      name: r.Dateiname || db.dateiname_original || b.original_name || '',
      fileId,
      gross,
      businessVat,
      privateVat,
      mixed: hasPrivate,
      hint,
      fileUrl: r.file_url || db.file_url || b.file_url || ''
    });
  }

  hits.sort((a, b) => a.date.localeCompare(b.date));

  const report: string[] = [];
  report.push('# Tankstellen-Split-Report 2023');
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Gefundene Kraftstoffbelege: ${hits.length}`);
  report.push(`- Davon MIXED (private Marker erkannt): ${hits.filter((h) => h.mixed).length}`);
  report.push('');
  report.push('| Datum | Lieferant | Brutto | geschaeftl. MwSt | private MwSt | MIXED | Hinweis | Datei |');
  report.push('|---|---|---:|---:|---:|---|---|---|');
  for (const h of hits) {
    report.push(`| ${h.date || '-'} | ${h.supplier || '-'} | ${h.gross.toFixed(2)} | ${h.businessVat.toFixed(2)} | ${h.privateVat.toFixed(2)} | ${h.mixed ? 'JA' : 'NEIN'} | ${h.hint} | ${h.fileUrl || h.fileId} |`);
  }

  fs.writeFileSync(REPORT_PATH, report.join('\n') + '\n', 'utf8');
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    fuelReceipts: hits.length,
    mixed: hits.filter((h) => h.mixed).length
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

