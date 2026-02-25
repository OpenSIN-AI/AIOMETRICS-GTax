import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const PRIVATE_FOLDER_ID = process.env.PRIVATE_FOLDER_ID || '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_PRIVATE_RECLASSIFY_REPORT.md');

const auth = new JWT({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type FileMeta = drive_v3.Schema$File;
type Flow = 'Einnahmen' | 'Ausgaben';

interface FolderTargets {
  incomeByYear: Map<string, string>;
  expenseByYear: Map<string, string>;
}

interface BelegeInfo {
  extractedText: string;
  ocrText: string;
  originalName: string;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectYear(text: string): string {
  const years = text.match(/\b20(2[2-9]|3[0-1])\b/g) || [];
  if (years.length === 0) return '';
  const counts = new Map<string, number>();
  for (const y of years) counts.set(y, (counts.get(y) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function inferYearFromName(name: string): string {
  const iso = name.match(/\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/);
  if (iso) return iso[1];
  const dmy = name.match(/\b(\d{1,2})[.\-_](\d{1,2})[.\-_](20\d{2})\b/);
  if (dmy) return dmy[3];
  return '';
}

function listAnyMatch(probe: string, words: string[]): boolean {
  return words.some((w) => probe.includes(w));
}

const PRIVATE_MARKERS = [
  'netflix', 'apotheke', 'apotheken', 'lidl', 'rewe', 'edeka', 'flink',
  'lieferando', 'wolt', 'tierfutter', 'drogerie', 'lebensmittel',
  'zigarette', 'tabak', 'bier', 'hdi', 'privat'
];

const BUSINESS_MARKERS = [
  'rechnung', 'invoice', 'abschlagsrechnung', 'schlussrechnung', 'teilrechnung',
  'material', 'modul', 'wechselrichter', 'montage', 'pv', 'photovoltaik',
  'angebot', 'auftrag', 'lieferschein', 'ust-id', 'mwst', 'umsatzsteuer'
];

function classifyAsBusiness(probe: string): { business: boolean; flow: Flow } {
  const ownerIncome = /zoe solar|zoe\b|jeremy schulze/.test(probe) || /\b\d{4}\.\d+\.\d+\b/.test(probe);
  const hasBusiness = listAnyMatch(probe, BUSINESS_MARKERS);
  const hasPrivate = listAnyMatch(probe, PRIVATE_MARKERS);
  if (hasBusiness && !hasPrivate) {
    return { business: true, flow: ownerIncome ? 'Einnahmen' : 'Ausgaben' };
  }
  // Strong override: user reported this specific file as non-private
  if (probe.includes('1ypfspa3m2zzynkbujk_6j0jazt4wemwe')) {
    return { business: true, flow: 'Ausgaben' };
  }
  return { business: false, flow: 'Ausgaben' };
}

function ext(name: string): string {
  const m = name.match(/(\.[A-Za-z0-9]{2,6})$/);
  return m ? m[1].toLowerCase() : '.pdf';
}

function slug(v: string): string {
  return (v || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'beleg';
}

async function listChildren(folderId: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,webViewLink,createdTime,modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function loadTargets(): Promise<FolderTargets> {
  const incomeByYear = new Map<string, string>();
  const expenseByYear = new Map<string, string>();
  const years = await listChildren(ACCOUNTING_ROOT_FOLDER_ID);
  const yearFolders = years.filter((f) => /^\d{4}$/.test(f.name || ''));
  await Promise.all(yearFolders.map(async (yf) => {
    const year = yf.name as string;
    const child = await listChildren(yf.id as string);
    const inc = child.find((c) => normalize(c.name || '').startsWith('einnahmen'));
    const exp = child.find((c) => normalize(c.name || '').startsWith('ausgaben'));
    if (inc?.id) incomeByYear.set(year, inc.id);
    if (exp?.id) expenseByYear.set(year, exp.id);
  }));
  return { incomeByYear, expenseByYear };
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

async function moveToTarget(file: FileMeta, newName: string, targetFolderId: string): Promise<void> {
  await drive.files.update({
    fileId: file.id as string,
    requestBody: { name: newName },
    addParents: targetFolderId,
    removeParents: PRIVATE_FOLDER_ID,
    fields: 'id',
    supportsAllDrives: true
  });
}

async function main(): Promise<void> {
  const [targets, belegeMap, files] = await Promise.all([
    loadTargets(),
    readBelegeMap(),
    listChildren(PRIVATE_FOLDER_ID)
  ]);

  const moved: Array<{ id: string; oldName: string; newName: string; flow: Flow; year: string; target: string }> = [];
  const kept: Array<{ id: string; name: string; reason: string }> = [];

  await Promise.all(files.map(async (f) => {
    if (!f.id || !f.name) return;
    const b = belegeMap.get(f.id);
    const text = normalize([
      f.id,
      f.name,
      b?.originalName || '',
      b?.extractedText || '',
      b?.ocrText || ''
    ].join('\n'));

    const cls = classifyAsBusiness(text);
    if (!cls.business) {
      kept.push({ id: f.id, name: f.name, reason: 'private_or_unclear' });
      return;
    }

    const year = detectYear(text) || inferYearFromName(f.name) || '2023';
    const target = cls.flow === 'Einnahmen'
      ? targets.incomeByYear.get(year)
      : targets.expenseByYear.get(year);
    if (!target) {
      kept.push({ id: f.id, name: f.name, reason: `missing_target_${cls.flow}_${year}` });
      return;
    }

    const newName = `${year}_${cls.flow}_RECLASS_${slug(f.name.replace(/\.[A-Za-z0-9]{2,6}$/,''))}${ext(f.name)}`;
    await moveToTarget(f, newName, target);
    moved.push({ id: f.id, oldName: f.name, newName, flow: cls.flow, year, target });
  }));

  const lines: string[] = [];
  lines.push('# MICRO Worker Report: Reclassify Privat Belege');
  lines.push('');
  lines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  lines.push(`- Quelle: ${PRIVATE_FOLDER_ID}`);
  lines.push(`- Verschoben: ${moved.length}`);
  lines.push(`- Behalten: ${kept.length}`);
  lines.push('');
  lines.push('## Verschoben');
  lines.push('');
  lines.push('| id | flow | year | target | alter Name | neuer Name |');
  lines.push('|---|---|---|---|---|---|');
  for (const m of moved) {
    lines.push(`| ${m.id} | ${m.flow} | ${m.year} | ${m.target} | ${m.oldName} | ${m.newName} |`);
  }
  lines.push('');
  lines.push('## Behalten (Top 100)');
  lines.push('');
  lines.push('| id | reason | name |');
  lines.push('|---|---|---|');
  for (const k of kept.slice(0, 100)) {
    lines.push(`| ${k.id} | ${k.reason} | ${k.name} |`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    moved: moved.length,
    kept: kept.length,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

