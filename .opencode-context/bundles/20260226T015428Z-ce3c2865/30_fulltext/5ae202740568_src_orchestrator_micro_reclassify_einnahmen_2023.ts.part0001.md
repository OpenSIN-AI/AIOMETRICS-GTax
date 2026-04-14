# Context Fulltext

- source_path: src/orchestrator/micro_reclassify_einnahmen_2023.ts
- source_sha256: 049a562443e79633df79d39b1bd362618c7e1ff3f5fe45ab35608d34d5e7bccc
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const EINNAHMEN_2023_FOLDER_ID = '1ksurKQAYf9vxSg9SV-KYYqV0ojKMuJge';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const PRIVATE_FOLDER_ID = '1Mt2Ojg_pgxwVh8jRJfhVE389KFTjEJqe';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_RECLASSIFY_EINNAHMEN_2023.md');

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
type TargetKind = 'keep' | 'ausgaben' | 'missing' | 'private';

interface BelegeInfo {
  extractedText: string;
  ocrText: string;
  originalName: string;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function slug(v: string): string {
  return (v || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'beleg';
}

function ext(name: string): string {
  const m = name.match(/(\.[A-Za-z0-9]{2,6})$/);
  return m ? m[1].toLowerCase() : '.pdf';
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

async function getAusgaben2023FolderId(): Promise<string> {
  const yearChildren = await listChildren('11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m');
  const target = yearChildren.find((f) => normalize(f.name || '').startsWith('ausgaben'));
  if (!target?.id) throw new Error('Ausgaben_2023 folder not found');
  return target.id;
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

function classify(probe: string): { kind: TargetKind; reason: string } {
  const privateMarkers = ['lidl', 'rewe', 'edeka', 'flink', 'lieferando', 'wolt', 'netflix', 'apotheke', 'tierfutter', 'drogerie', 'lebensmittel'];
  const incomingVendors = ['1&1', '1und1', 'ionos', 'amazon', 'deubaxxl', 'mytvshop', '11880', 'sunoyster', 'ecoflow'];
  const outgoingMarkers = ['zoe solar', 'jeremy schulze', 'abschlagsrechnung', 'abschlagszahlung', 'schlussrechnung', 'teilrechnung', 'rechnungsplan'];
  const confirmMarkers = ['bestellbestätigung', 'bestellbestaetigung', 'lieferbestätigung', 'lieferbestaetigung', 'auftrag', 'auftragsbestätigung', 'auftragsbestaetigung'];
  const invoiceNoPattern = /\b\d{4}\.\d+\.\d+\b/;

  let inScore = 0;
  let outScore = 0;
  if (privateMarkers.some((m) => probe.includes(m))) return { kind: 'private', reason: 'private_marker' };
  if (incomingVendors.some((m) => probe.includes(m))) inScore += 3;
  if (confirmMarkers.some((m) => probe.includes(m))) inScore += 2;
  if (/offene posten|summe offener posten|dsl/.test(probe)) inScore += 3;
  if (/rechnung|invoice/.test(probe)) inScore += 1;

  if (outgoingMarkers.some((m) => probe.includes(m))) outScore += 3;
  if (invoiceNoPattern.test(probe)) outScore += 2;
  if (/pv-anlage|installation wallbox|abschlagszahlung nach vertragsabschluss/.test(probe)) outScore += 2;

  if (inScore >= outScore + 2) return { kind: 'ausgaben', reason: `incoming_score_${inScore}_vs_${outScore}` };
  if (confirmMarkers.some((m) => probe.includes(m)) && !/rechnung|invoice/.test(probe)) return { kind: 'missing', reason: 'confirmation_without_invoice' };
  return { kind: 'keep', reason: 'likely_outgoing' };
}

async function move(file: FileMeta, targetFolderId: string, newName: string): Promise<void> {
  await drive.files.update({
    fileId: file.id as string,
    requestBody: { name: newName },
    addParents: targetFolderId,
    removeParents: EINNAHMEN_2023_FOLDER_ID,
    fields: 'id',
    supportsAllDrives: true
  });
}

async function main(): Promise<void> {
  const [files, belegeMap, ausgaben2023Id] = await Promise.all([
    listChildren(EINNAHMEN_2023_FOLDER_ID),
    readBelegeMap(),
    getAusgaben2023FolderId()
  ]);

  const moved: Array<{ id: string; from: string; to: string; reason: string; oldName: string; newName: string }> = [];
  const kept: Array<{ id: string; reason: string; name: string }> = [];

  for (const f of files) {
    if (!f.id || !f.name) continue;
    const b = belegeMap.get(f.id);
    const probe = normalize([
      f.name,
      b?.originalName || '',
      b?.extractedText || '',
      b?.ocrText || ''
    ].join('\n'));
    const c = classify(probe);
    if (c.kind === 'keep') {
      kept.push({ id: f.id, reason: c.reason, name: f.name });
      continue;
    }
    const target = c.kind === 'ausgaben' ? ausgaben2023Id : c.kind === 'missing' ? MISSING_FOLDER_ID : PRIVATE_FOLDER_ID;
    const newName = `2023_${c.kind === 'ausgaben' ? 'Ausgabe' : c.kind === 'missing' ? 'Missing' : 'Privat'}_RECLASS_${slug(f.name.replace(/\.[A-Za-z0-9]{2,6}$/,''))}${ext(f.name)}`;
    await move(f, target, newName);
    moved.push({ id: f.id, from: EINNAHMEN_2023_FOLDER_ID, to: target, reason: c.reason, oldName: f.name, newName });
  }

  const lines: string[] = [];
  lines.push('# MICRO Worker Report: Reclassify Einnahmen_2023');
  lines.push('');
  lines.push(`- Zeitstempel: ${new Date().toISOString()}`);
  lines.push(`- Quelle: ${EINNAHMEN_2023_FOLDER_ID}`);
  lines.push(`- Verschoben: ${moved.length}`);
  lines.push(`- Behalten: ${kept.length}`);
  lines.push('');
  lines.push('## Verschoben');
  lines.push('');
  lines.push('| id | reason | from | to | old | new |');
  lines.push('|---|---|---|---|---|---|');
  for (const m of moved) {
    lines.push(`| ${m.id} | ${m.reason} | ${m.from} | ${m.to} | ${m.oldName} | ${m.newName} |`);
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


```
