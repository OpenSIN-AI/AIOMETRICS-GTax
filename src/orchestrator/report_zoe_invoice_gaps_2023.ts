import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

dotenv.config();

interface EinnahmeRow {
  driveFileId: string;
  lieferant: string;
  kunde: string;
  rechnungsnr: string;
  datum: string;
  brutto: number;
  dateiname: string;
  fileUrl: string;
}

interface OrderGroup {
  key: string;
  customer: string;
  orderId: string;
  orderValue: number;
  invoiceSum: number;
  missing: number;
  invoiceRows: EinnahmeRow[];
}

const REPORT_PATH = path.join(process.cwd(), 'docs', 'ZOE_SOLAR_RECHNUNGSPLAN_2023.md');

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

function readTable(values: string[][]): Array<Record<string, string>> {
  if (values.length <= 1) return [];
  const headers = values[0].map((h) => String(h || '').trim());
  const rows: Array<Record<string, string>> = [];
  for (const row of values.slice(1)) {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      out[h] = String(row[i] || '');
    });
    rows.push(out);
  }
  return rows;
}

function normalize(v: string): string {
  return (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractOrderId(text: string): string {
  const patterns = [
    /auftrags(?:nr|nummer)?\s*[:#]?\s*([A-Z0-9\-\/]{4,})/i,
    /auftrag\s*[:#]?\s*([A-Z0-9\-\/]{4,})/i,
    /projekt\s*[:#]?\s*([A-Z0-9\-\/]{4,})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function extractOrderValue(text: string): number {
  const patterns = [
    /auftragswert[^\d]{0,20}([\d.,]{1,20})/i,
    /auftragssumme[^\d]{0,20}([\d.,]{1,20})/i,
    /gesamt(?:auftrags|auftrag)?wert[^\d]{0,20}([\d.,]{1,20})/i,
    /gesamtpreis[^\d]{0,20}([\d.,]{1,20})/i,
    /auftrag\s*gesamt[^\d]{0,20}([\d.,]{1,20})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const amount = parseAmount(m[1]);
      if (amount > 0) return amount;
    }
  }
  return 0;
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const [incomeResp, dbResp, belegeResp] = await Promise.all([
    sheetsApi.spreadsheets.values.get({ spreadsheetId, range: 'Einnahmen_2023' }),
    sheetsApi.spreadsheets.values.get({ spreadsheetId, range: 'Buchhaltung_DB' }),
    sheetsApi.spreadsheets.values.get({ spreadsheetId, range: 'belege' })
  ]);

  const incomeRows = readTable((incomeResp.data.values || []) as string[][]);
  const dbRows = readTable((dbResp.data.values || []) as string[][]);
  const belegeRows = readTable((belegeResp.data.values || []) as string[][]);

  const dbById = new Map<string, Record<string, string>>();
  for (const r of dbRows) {
    const id = r.drive_file_id || '';
    if (id) dbById.set(id, r);
  }
  const belegeById = new Map<string, Record<string, string>>();
  for (const r of belegeRows) {
    const id = r.drive_file_id || '';
    if (id) belegeById.set(id, r);
  }

  const candidates: EinnahmeRow[] = [];
  const orderMeta = new Map<string, { orderId: string; customer: string; orderValue: number }>();

  for (const row of incomeRows) {
    const driveFileId = row.drive_file_id || '';
    if (!driveFileId) continue;

    const db = dbById.get(driveFileId) || {};
    const beleg = belegeById.get(driveFileId) || {};

    const lieferant = row.Lieferant || db.lieferant || '';
    const kunde = row.kunde || db.kunde || '';
    const rechnungsnr = row.Rechnungsnr || db.belegnr || '';
    const datum = row.Datum || db.belegdatum || '';
    const brutto = parseAmount(row.Betrag_Brutto || db.brutto_gesamt || '');
    const dateiname = row.Dateiname || db.dateiname_standardisiert || db.dateiname_original || beleg.original_name || '';
    const fileUrl = row.file_url || db.file_url || beleg.file_url || '';

    const text = [
      lieferant,
      kunde,
      rechnungsnr,
      dateiname,
      beleg.extracted_text || '',
      beleg.ocr_text || ''
    ].join('\n');

    const probe = normalize(text);
    const ownInvoice = probe.includes('zoe') || probe.includes('jeremy schulze');
    if (!ownInvoice) continue;

    candidates.push({
      driveFileId,
      lieferant,
      kunde,
      rechnungsnr,
      datum,
      brutto,
      dateiname,
      fileUrl
    });

    const orderId = extractOrderId(text);
    const orderValue = extractOrderValue(text);
    const key = orderId || normalize(kunde) || normalize(lieferant) || driveFileId;
    const existing = orderMeta.get(key) || { orderId, customer: kunde || lieferant, orderValue: 0 };
    if (orderValue > existing.orderValue) {
      existing.orderValue = orderValue;
    }
    if (!existing.orderId && orderId) existing.orderId = orderId;
    if (!existing.customer && (kunde || lieferant)) existing.customer = kunde || lieferant;
    orderMeta.set(key, existing);
  }

  const groups = new Map<string, OrderGroup>();
  for (const row of candidates) {
    const keyProbe = normalize([row.kunde, row.lieferant, row.dateiname].join(' '));
    let selectedKey = '';

    for (const [k, meta] of orderMeta.entries()) {
      const orderToken = normalize(meta.orderId);
      const customerToken = normalize(meta.customer);
      if (orderToken && keyProbe.includes(orderToken)) {
        selectedKey = k;
        break;
      }
      if (!selectedKey && customerToken && keyProbe.includes(customerToken)) {
        selectedKey = k;
      }
    }

    if (!selectedKey) {
      selectedKey = normalize(row.kunde || row.lieferant || row.dateiname);
      if (!selectedKey) selectedKey = row.driveFileId;
    }

    const meta = orderMeta.get(selectedKey) || { orderId: '', customer: row.kunde || row.lieferant, orderValue: 0 };
    const existing = groups.get(selectedKey) || {
      key: selectedKey,
      customer: meta.customer || row.kunde || row.lieferant,
      orderId: meta.orderId,
      orderValue: meta.orderValue,
      invoiceSum: 0,
      missing: 0,
      invoiceRows: []
    };

    existing.invoiceRows.push(row);
    existing.invoiceSum += row.brutto;
    if (meta.orderValue > existing.orderValue) existing.orderValue = meta.orderValue;
    if (!existing.orderId && meta.orderId) existing.orderId = meta.orderId;
    groups.set(selectedKey, existing);
  }

  const outGroups = Array.from(groups.values())
    .map((g) => {
      g.invoiceRows.sort((a, b) => a.datum.localeCompare(b.datum));
      g.missing = g.orderValue > 0 ? Math.max(0, g.orderValue - g.invoiceSum) : 0;
      return g;
    })
    .sort((a, b) => b.missing - a.missing);

  const report: string[] = [];
  report.push('# ZOE Solar Rechnungsplan-Check 2023');
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Gefundene ZOE/Jeremy Einnahme-Rechnungen: ${candidates.length}`);
  report.push(`- Auftragsgruppen: ${outGroups.length}`);
  report.push('');

  report.push('## Gruppenübersicht');
  report.push('');
  report.push('| Gruppe | Kunde | Auftragsnr | Auftragswert | Summe Rechnungen | Fehlbetrag |');
  report.push('|---|---|---|---:|---:|---:|');
  for (const g of outGroups) {
    report.push(`| ${g.key} | ${g.customer || '-'} | ${g.orderId || '-'} | ${g.orderValue.toFixed(2)} | ${g.invoiceSum.toFixed(2)} | ${g.missing.toFixed(2)} |`);
  }
  report.push('');

  report.push('## Rechnungsdetails');
  report.push('');
  for (const g of outGroups) {
    report.push(`### Gruppe: ${g.key}`);
    report.push('');
    for (const r of g.invoiceRows) {
      report.push(`- ${r.datum || '-'} | ${r.rechnungsnr || '-'} | ${r.brutto.toFixed(2)} EUR | ${r.dateiname} | ${r.fileUrl}`);
    }
    report.push('');
  }

  report.push('## Bewertung');
  report.push('');
  report.push('- Ein Fehlbetrag > 0 bedeutet: Auftragswert groesser als Summe gefundener Rechnungen.');
  report.push('- Bei Auftragswert = 0 konnte aus den vorhandenen Texten kein belastbarer Auftragswert extrahiert werden (manuelle Pruefung noetig).');

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf8');

  const withGap = outGroups.filter((g) => g.missing > 0.01).length;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    invoiceCount: candidates.length,
    groups: outGroups.length,
    groupsWithGap: withGap
  }, null, 2));
}

main().catch((error) => {
  console.error('report_zoe_invoice_gaps_2023 failed:', error);
  process.exit(1);
});
