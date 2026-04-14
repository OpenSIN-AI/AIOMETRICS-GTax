# Context Fulltext

- source_path: src/orchestrator/micro_move_zoe_invoices.ts
- source_sha256: f023e9befba6abb88bd4ac9dbffe0d9058df4394eccdf006194a3e22da58fe24
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;

const DEFAULT_SOURCE_FOLDERS = [
  '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy', // Fehlende Rechnungen
  '1zNe32myPv0qnR7uDmTnUpeGnkY4lBT-U', // Archiviert
  '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe', // Privat Belege
  '1PWhKpWPYNEAB4R7wz5wc_KJU1tlqdzSi',
  '1ddcnNid0f0xGsiHVMHTjn84832-m3ALZ',
  '1MgCstnwUBlD5EOqM7ZU2Dkpum3YxAerA'
];

const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_ZOE_MOVE_REPORT.md');

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]
});

const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type FileMeta = drive_v3.Schema$File;

interface BelegeInfo {
  extractedText: string;
  ocrText: string;
  originalName: string;
}

interface MoveResult {
  fileId: string;
  oldName: string;
  newName: string;
  sourceFolderId: string;
  targetFolderId: string;
  year: string;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectInvoiceNo(text: string): string {
  const m = text.match(/\b\d{4}\.\d+\.\d+\b/);
  if (m) return m[0];
  const m2 = text.match(/(?:rechnungs?nr\.?|invoice\s*no\.?)\s*[:#]?\s*([A-Za-z0-9.\-_/]{4,})/i);
  return m2?.[1] || '';
}

function detectYear(text: string): string {
  const years = (text.match(/\b20(2[2-9]|3[0-1])\b/g) || []);
  if (years.length === 0) return '';
  const count = new Map<string, number>();
  for (const y of years) count.set(y, (count.get(y) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function inferYearFromName(name: string): string {
  const iso = name.match(/\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/);
  if (iso) return iso[1];
  const dmy = name.match(/\b(\d{1,2})[.\-_](\d{1,2})[.\-_](20\d{2})\b/);
  if (dmy) return dmy[3];
  return '';
}

function isZoeInvoice(probe: string): boolean {
  const hasOwner = /zoe solar|zoe\b|jeremy schulze/.test(probe);
  const hasInvoiceMarker = /rechnung|abschlagsrechnung|abschlagszahlung|schlussrechnung|teilrechnung|teilzahlung|invoice|rechnungsplan/.test(probe);
  const hasInvoiceNo = /\b\d{4}\.\d+\.\d+\b/.test(probe);
  const likelyPrivate = /netflix|apotheke|lidl|rewe|edeka|flink|wolt|lieferando|tierfutter|drogerie|lebensmittel/.test(probe);
  if (likelyPrivate) return false;
  if (hasOwner && (hasInvoiceMarker || hasInvoiceNo)) return true;
  // Fallback for user's own invoice numbering pattern (e.g. 1111.1.1)
  if (hasInvoiceNo && hasInvoiceMarker) return true;
  return false;
}

function extFromName(name: string): string {
  const m = name.match(/(\.[A-Za-z0-9]{2,6})$/);
  return m ? m[1].toLowerCase() : '.pdf';
}

function slug(s: string): string {
  return (s || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'beleg';
}

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: [REDACTED] | undefined;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: [REDACTED]
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(r.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);
  return out;
}

async function getYearIncomeFolders(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const yearFolders = await listChildren(ACCOUNTING_ROOT_FOLDER_ID);
  const candidates = yearFolders.filter((f) => /^\d{4}$/.test(f.name || ''));

  await Promise.all(candidates.map(async (yf) => {
    const year = yf.name as string;
    const children = await listChildren(yf.id as string);
    const income = children.find((c) => normalize(c.name || '').startsWith('einnahmen'));
    if (income?.id) map.set(year, income.id);
  }));
  return map;
}

async function readBelegeMap(): Promise<Map<string, BelegeInfo>> {
  const out = new Map<string, BelegeInfo>();
  if (!SPREADSHEET_ID) return out;
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'belege!A1:AZ'
  });
  const rows = (r.data.values || []) as string[][];
  if (rows.length <= 1) return out;
  const h = rows[0];
  const iId = h.indexOf('drive_file_id');
  const iExt = h.indexOf('extracted_text');
  const iOcr = h.indexOf('ocr_text');
  const iName = h.indexOf('original_name');
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row[iId] || '').trim();
    if (!id) continue;
    out.set(id, {
      extractedText: String(row[iExt] || ''),
      ocrText: String(row[iOcr] || ''),
      originalName: String(row[iName] || '')
    });
  }
  return out;
}

async function moveOne(
  file: FileMeta,
  sourceFolderId: string,
  targetFolderId: string,
  newName: string
): Promise<void> {
  await drive.files.update({
    fileId: file.id as string,
    requestBody: { name: newName },
    addParents: targetFolderId,
    removeParents: sourceFolderId,
    fields: 'id',
    supportsAllDrives: true
  });
}

async function main(): Promise<void> {
  const sourceFolderIds = (process.env.SOURCE_FOLDER_IDS || DEFAULT_SOURCE_FOLDERS.join(','))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const [yearIncomeFolders, belegeMap] = await Promise.all([
    getYearIncomeFolders(),
    readBelegeMap()
  ]);

  const moved: MoveResult[] = [];
  const skipped: Array<{ fileId: string; name: string; reason: string; sourceFolderId: string }> = [];

  await Promise.all(sourceFolderIds.map(async (sourceFolderId) => {
    const files = await listChildren(sourceFolderId);
    await Promise.all(files.map(async (file) => {
      if (!file.id || !file.name) return;
      const b = belegeMap.get(file.id);
      const probe = normalize([
        file.name,
        b?.originalName || '',
        b?.extractedText || '',
        b?.ocrText || ''
      ].join('\n'));

      if (!isZoeInvoice(probe)) {
        skipped.push({ fileId: file.id, name: file.name, reason: 'not_zoe_invoice', sourceFolderId });
        return;
      }

      const year = detectYear(probe) || inferYearFromName(file.name) || '';
      const targetYear = yearIncomeFolders.has(year) ? year : '';
      if (!targetYear) {
        skipped.push({ fileId: file.id, name: file.name, reason: `missing_target_year:${year || 'unknown'}`, sourceFolderId });
        return;
      }

      const invoiceNo = detectInvoiceNo(probe) || 'ohne_belegnr';
      const ext = extFromName(file.name);
      const newName = `${targetYear}_Einnahme_ZOE_${slug(invoiceNo)}_${slug(file.name.replace(/\.[A-Za-z0-9]{2,6}$/,''))}${ext}`;
      const targetFolderId = yearIncomeFolders.get(targetYear) as string;
      await moveOne(file, sourceFolderId, targetFolderId, newName);
      moved.push({
        fileId: file.id,
        oldName: file.name,
        newName,
        sourceFolderId,
        targetFolderId,
        year: targetYear
      });
    }));
  }));

  const report: string[] = [];
  report.push('# MICRO Worker Report: ZOE-Rechnungen umsortieren');
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Quelle Ordner: ${sourceFolderIds.join(', ')}`);
  report.push(`- Verschoben: ${moved.length}`);
  report.push(`- Uebersprungen: ${skipped.length}`);
  report.push('');
  report.push('## Verschoben');
  report.push('');
  report.push('| fileId | Jahr | von | nach | alter Name | neuer Name |');
  report.push('|---|---|---|---|---|---|');
  for (const m of moved) {
    report.push(`| ${m.fileId} | ${m.year} | ${m.sourceFolderId} | ${m.targetFolderId} | ${m.oldName} | ${m.newName} |`);
  }
  report.push('');
  report.push('## Uebersprungen (Top 100)');
  report.push('');
  report.push('| fileId | von | reason | name |');
  report.push('|---|---|---|---|');
  for (const s of skipped.slice(0, 100)) {
    report.push(`| ${s.fileId} | ${s.sourceFolderId} | ${s.reason} | ${s.name} |`);
  }

  fs.writeFileSync(REPORT_PATH, report.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    moved: moved.length,
    skipped: skipped.length,
    reportPath: REPORT_PATH,
    sourceFolderIds
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

```
