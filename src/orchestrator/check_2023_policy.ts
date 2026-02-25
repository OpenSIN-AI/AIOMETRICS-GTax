import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

interface PolicyRow {
  tab: 'Einnahmen_2023' | 'Ausgaben_2023';
  rowNumber: number;
  driveFileId: string;
  lieferant: string;
  datum: string;
  mwstSatz: string;
  mwst7: number;
  mwst0: number;
  kategorie: string;
  status: string;
  dateiname: string;
  reasons: string[];
}

const REPORT_PATH = path.join(process.cwd(), 'docs', 'CHECK_2023_POLICY.md');

const PRIVATE_KEYWORDS = [
  'flink',
  'getranke hoffmann',
  'getraenke hoffmann',
  'lidl',
  'rewe',
  'edeka',
  'wolt',
  'lieferando',
  'woolworth',
  'netflix',
  'apotheke',
  'apotheken',
  'tierfutter',
  'drogerie',
  'lebensmittel',
  'hdi',
  'strom',
  'vattenfall',
  'eplus',
  'handykarte'
];

const ARCHIVE_KEYWORDS = [
  'miete',
  'hausverwaltung',
  'behörde',
  'behoerde',
  'behördengebühr',
  'behoerdengebuehr',
  'finanzamt',
  'aok',
  'sbk',
  'arag',
  'mitteilung',
  'bescheid',
  'übertragungsprotokoll',
  'uebertragungsprotokoll'
];

const FUEL_KEYWORDS = [
  'kraftstoff',
  'benzin',
  'diesel',
  'super e5',
  'super e10',
  'tankstelle',
  'liter'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function parseAmount(value: string): number {
  const raw = (value || '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') && clean.includes('.')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function probeText(values: string[]): string {
  return values.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasKeyword(probe: string, words: string[]): boolean {
  return words.some((w) => probe.includes(w));
}

function isUnknownSupplier(value: string): boolean {
  const v = (value || '').trim().toLowerCase();
  if (!v) return true;
  if (['unklar', 'unknown', 'n/a', 'null', 'beleg'].includes(v)) return true;
  if (v.endsWith('.pdf') || v.endsWith('.jpg') || v.endsWith('.png')) return true;
  if (v.includes('img_') || v.includes('screenshot') || v.includes('rechnung_')) return true;
  if (/^\d+$/.test(v)) return true;
  return false;
}

async function readRows(
  sheetsApi: any,
  spreadsheetId: string,
  tab: 'Einnahmen_2023' | 'Ausgaben_2023'
): Promise<PolicyRow[]> {
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: tab
  });
  const values: string[][] = response.data.values || [];
  if (values.length <= 1) return [];

  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);

  const iDrive = idx('drive_file_id');
  const iLieferant = idx('Lieferant');
  const iDatum = idx('Datum');
  const iMwstSatz = idx('MwSt_Satz');
  const iMwst7 = idx('mwst_7_betrag');
  const iMwst0 = idx('mwst_0_betrag');
  const iKategorie = idx('Kategorie');
  const iStatus = idx('Status');
  const iDateiname = idx('Dateiname');
  const iBemerkung = idx('Bemerkung');

  const out: PolicyRow[] = [];
  values.slice(1).forEach((row, i) => {
    const driveFileId = row[iDrive] || '';
    if (!driveFileId) return;

    const lieferant = row[iLieferant] || '';
    const datum = row[iDatum] || '';
    const mwstSatz = row[iMwstSatz] || '';
    const mwst7 = parseAmount(row[iMwst7] || '');
    const mwst0 = parseAmount(row[iMwst0] || '');
    const kategorie = row[iKategorie] || '';
    const status = row[iStatus] || '';
    const dateiname = row[iDateiname] || '';
    const bemerkung = row[iBemerkung] || '';

    const reasons: string[] = [];
    const probe = probeText([lieferant, kategorie, status, dateiname, bemerkung]);
    const isFuelReceipt = hasKeyword(probe, FUEL_KEYWORDS);

    if (isUnknownSupplier(lieferant)) {
      reasons.push('lieferant_unbekannt_oder_kryptisch');
    }

    if (tab === 'Ausgaben_2023') {
      if (!isFuelReceipt && (mwst7 > 0 || /(^|[^0-9])7([^0-9]|$)/.test(mwstSatz))) {
        reasons.push('ausgaben_7_prozent_nicht_erlaubt');
      }
      if (!isFuelReceipt && (mwst0 > 0 || mwstSatz.trim() === '0')) {
        reasons.push('ausgaben_0_prozent_nicht_erlaubt');
      }
      if (hasKeyword(probe, PRIVATE_KEYWORDS)) {
        reasons.push('privatbeleg_marker');
      }
      if (hasKeyword(probe, ARCHIVE_KEYWORDS)) {
        reasons.push('archiv_marker');
      }
    }

    if (!datum) {
      reasons.push('datum_fehlt');
    }

    if (reasons.length > 0) {
      out.push({
        tab,
        rowNumber: i + 2,
        driveFileId,
        lieferant,
        datum,
        mwstSatz,
        mwst7,
        mwst0,
        kategorie,
        status,
        dateiname,
        reasons
      });
    }
  });

  return out;
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const [incomeViolations, expenseViolations] = await Promise.all([
    readRows(sheetsApi, spreadsheetId, 'Einnahmen_2023'),
    readRows(sheetsApi, spreadsheetId, 'Ausgaben_2023')
  ]);

  const all = [...incomeViolations, ...expenseViolations];
  const reasonCounts = new Map<string, number>();
  for (const row of all) {
    for (const reason of row.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }

  const report: string[] = [];
  report.push('# CHECK 2023 Policy');
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  report.push(`- Einnahmen Violations: ${incomeViolations.length}`);
  report.push(`- Ausgaben Violations: ${expenseViolations.length}`);
  report.push(`- Gesamt Violations: ${all.length}`);
  report.push('');

  if (reasonCounts.size > 0) {
    report.push('## Reason Counts');
    report.push('');
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      report.push(`- ${reason}: ${count}`);
    }
    report.push('');
  }

  if (all.length > 0) {
    report.push('## Verstossliste (Top 2000)');
    report.push('');
    for (const row of all.slice(0, 2000)) {
      report.push(`- ${row.tab} Row ${row.rowNumber} | ${row.driveFileId} | ${row.lieferant} | ${row.dateiname} | ${row.reasons.join(',')}`);
    }
    report.push('');
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf8');

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    incomeViolations: incomeViolations.length,
    expenseViolations: expenseViolations.length,
    totalViolations: all.length,
    reasonCounts: Object.fromEntries(reasonCounts),
    zeroPolicyViolations: all.length === 0
  }, null, 2));
}

main().catch((error) => {
  console.error('check_2023_policy failed:', error);
  process.exit(1);
});
