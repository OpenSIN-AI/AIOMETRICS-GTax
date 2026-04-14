# Context Fulltext

- source_path: src/orchestrator/repair_2023.ts
- source_sha256: 0f706c6982ec4756cf54653e720a13104fae58266c0636c9ab698f61fe4114e9
- chunk: 3/5

```text
    () => driveApi.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      supportsAllDrives: true,
      fields: 'id,parents'
    }),
    `moveFile.update.${fileId}`
  );
}

async function readTableRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<Record<string, string>[]> {
  const response = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }),
    `readTableRows.${range}`
  );
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0].map((h) => String(h || '').trim());
  const out: Record<string, string>[] = [];
  for (const row of values.slice(1)) {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = String(row[i] || '');
    });
    if (Object.values(obj).some((v) => v !== '')) out.push(obj);
  }
  return out;
}

function chooseOriginal(files: DriveFile[]): DriveFile {
  return [...files].sort((a, b) => {
    const aTs = Date.parse(a.createdTime || a.modifiedTime || '');
    const bTs = Date.parse(b.createdTime || b.modifiedTime || '');
    const aVal = Number.isNaN(aTs) ? Number.MAX_SAFE_INTEGER : aTs;
    const bVal = Number.isNaN(bTs) ? Number.MAX_SAFE_INTEGER : bTs;
    if (aVal !== bVal) return aVal - bVal;
    return a.id.localeCompare(b.id);
  })[0];
}

function toTimestamp(file: DriveFile): number {
  const ts = Date.parse(file.createdTime || file.modifiedTime || '');
  if (Number.isNaN(ts)) return Number.MAX_SAFE_INTEGER;
  return ts;
}

function normalizeKeyValue(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(value: [REDACTED]
  const stop = new Set([
    'der', 'die', 'das', 'und', 'oder', 'von', 'mit', 'auf', 'für', 'fuer', 'zum', 'zur', 'des', 'den',
    'dem', 'ein', 'eine', 'einer', 'eines', 'netto', 'brutto', 'mwst', 'ust', 'eur', 'euro', 'gesamt',
    'rechnung', 'beleg', 'invoice', 'quittung', 'zahlbetrag', 'summe', 'betrag'
  ]);
  const normalized = normalizeKeyValue(value);
  const tokens = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 400);
  return new Set(tokens);
}

function tokenOverlapScore(a: [REDACTED]
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) inter++;
  }
  return inter / Math.max(1, Math.min(a.size, b.size));
}

function buildContentDoc(file: DriveFile, db: DbRow | undefined, beleg: BelegeRow | undefined): ContentDoc {
  const supplier = normalizeKeyValue(db?.lieferant || beleg?.category || '');
  const invoiceNo = normalizeKeyValue(db?.belegnr || '');
  const date = normalizeDate(db?.belegdatum || '') || inferDateFromName(file.name);
  const gross = parseAmount(db?.brutto_gesamt || '');
  const contentProbe = [
    file.name,
    db?.lieferant || '',
    db?.belegnr || '',
    db?.belegdatum || '',
    db?.brutto_gesamt || '',
    db?.steuerkategorie || '',
    db?.kunde || '',
    db?.hinweis || '',
    (beleg?.extracted_text || '').slice(0, 6000),
    (beleg?.ocr_text || '').slice(0, 6000)
  ].join('\n');
  const tokens = tokenizeForSimilarity(contentProbe);
  return { file, supplier, invoiceNo, date, gross, tokens };
}

function isContentDuplicate(a: ContentDoc, b: ContentDoc): boolean {
  const sameInvoiceNo = a.invoiceNo && b.invoiceNo && a.invoiceNo === b.invoiceNo;
  const sameDate = a.date && b.date && a.date === b.date;
  const sameSupplier = a.supplier && b.supplier && (
    a.supplier === b.supplier ||
    a.supplier.includes(b.supplier) ||
    b.supplier.includes(a.supplier)
  );
  const sameAmount = a.gross > 0 && b.gross > 0 && Math.abs(a.gross - b.gross) <= 0.02;
  const score = tokenOverlapScore(a.tokens, b.tokens);

  if (sameInvoiceNo && sameAmount) return true;
  if (sameInvoiceNo && sameSupplier && (sameAmount || sameDate)) return true;
  if (sameAmount && sameDate && score >= 0.72) return true;
  if (sameAmount && score >= 0.84) return true;
  if (sameSupplier && sameAmount && score >= 0.68) return true;
  if (score >= 0.93 && (sameDate || sameAmount || sameSupplier)) return true;
  return false;
}

function dbRowToYearlyRow(
  dbRow: DbRow,
  belegRow: BelegeRow | undefined,
  file: DriveFile,
  fallbackName: string,
  flow: Flow
): string[] {
  const vatBusiness = parseAmount(dbRow.geschaeftliche_mwst || '');
  const vatFromRates = parseAmount(dbRow.mwst_19_betrag || '') + parseAmount(dbRow.mwst_7_betrag || '');
  const mwstBetrag = vatBusiness > 0 ? vatBusiness : vatFromRates;
  const dateiname = dbRow.dateiname_standardisiert || dbRow.dateiname_original || belegRow?.original_name || fallbackName;
  const type = dbRow.belegart || (flow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe');
  const supplier = sanitizeSupplier(dbRow.lieferant || '', dateiname, belegRow);
  const belegdatum = normalizeDate(dbRow.belegdatum || '')
    || inferDateFromName(dateiname)
    || inferDateFromName(file.name)
    || dateFromDriveTimestamp(file.modifiedTime || file.createdTime);

  return [
    belegdatum,
    supplier,
    dbRow.belegnr || '',
    type,
    dbRow.netto_gesamt || '',
    detectMwstSatz(dbRow),
    mwstBetrag ? mwstBetrag.toFixed(2) : '',
    dbRow.brutto_gesamt || '',
    dbRow.steuerkategorie || belegRow?.category || '',
    dbRow.status || '',
    dbRow.hinweis || '',
    dateiname,
    dbRow.duplikat_gruppe || '',
    dbRow.drive_file_id || belegRow?.drive_file_id || '',
    dbRow.file_url || belegRow?.file_url || '',
    dbRow.beleg_id || '',
    dbRow.kunde || '',
    dbRow.leistungsdatum || '',
    dbRow.mwst_19_betrag || '',
    dbRow.mwst_7_betrag || '',
    dbRow.mwst_0_betrag || '',
    dbRow.geschaeftliche_mwst || '',
    dbRow.private_mwst || '',
    dbRow.geschaeftlicher_anteil_brutto || '',
    dbRow.privater_anteil_brutto || '',
    dbRow.sollkonto || '',
    dbRow.habenkonto || '',
    dbRow.iban || '',
    dbRow.bic || '',
    dbRow.bankleitzahl || '',
    dbRow.line_items_json || '',
    dbRow.source_folder_id || belegRow?.source_folder_id || '',
    dbRow.target_folder_id || belegRow?.target_folder_id || '',
    dbRow.analyzed_at || belegRow?.analyzed_at || '',
    dbRow.dateiname_original || belegRow?.original_name || fallbackName,
    dbRow.dateiname_standardisiert || '',
    belegRow?.extracted_text || '',
    belegRow?.ocr_text || '',
    belegRow?.metadata || ''
  ];
}

function fallbackYearlyRow(file: DriveFile, belegRow: BelegeRow | undefined, flow: Flow): string[] {
  const type = flow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe';
  const supplier = inferSupplierFromName(file.name) || 'Beleg';
  const belegdatum = inferDateFromName(file.name) || dateFromDriveTimestamp(file.modifiedTime || file.createdTime);
  return [
    belegdatum,
    supplier,
    '',
    type,
    '',
    '',
    '',
    '',
    belegRow?.category || '',
    'pending',
    'Auto-fallback: kein Buchhaltung_DB-Eintrag',
    file.name,
    '',
    file.id,
    file.webViewLink,
    file.id,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '[]',
    belegRow?.source_folder_id || '',
    belegRow?.target_folder_id || file.parentId,
    belegRow?.analyzed_at || '',
    belegRow?.original_name || file.name,
    '',
    belegRow?.extracted_text || '',
    belegRow?.ocr_text || '',
    belegRow?.metadata || ''
  ];
}

async function ensureSheet(sheetsApi: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<number> {
  const ss = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }),
    `ensureSheet.get.${title}`
  );
  const existing = (ss.data.sheets || []).find((s) => s.properties?.title === title);
  if (typeof existing?.properties?.sheetId === 'number') return existing.properties.sheetId;

  const create = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    }),
    `ensureSheet.create.${title}`
  );
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Failed to create sheet ${title}`);
  return id;
}

async function writeYearSheet(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: string[][]
): Promise<void> {
  const sheetId = await ensureSheet(sheetsApi, spreadsheetId, title);
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: `${title}!A:ZZ` }),
    `writeYearSheet.clear.${title}`
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [YEARLY_HEADERS, ...rows] }
    }),
    `writeYearSheet.update.${title}`
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: YEARLY_HEADERS.length
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat.textFormat.bold'
            }
          },
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: Math.max(1, rows.length + 1),
                  startColumnIndex: 0,
                  endColumnIndex: YEARLY_HEADERS.length
                }
              }
            }
          }
        ]
      }
    }),
    `writeYearSheet.format.${title}`
  );
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const driveApi = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const yearFolder = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, TARGET_YEAR);
  if (!yearFolder) throw new Error(`${TARGET_YEAR} folder not found`);
  const incomeFolderName = `Einnahmen_${TARGET_YEAR}`;
  const expenseFolderName = `Ausgaben_${TARGET_YEAR}`;
  const incomeFolder = await findFolderByName(driveApi, yearFolder.id, incomeFolderName);
  const expenseFolder = await findFolderByName(driveApi, yearFolder.id, expenseFolderName);
  if (!incomeFolder || !expenseFolder) throw new Error(`${incomeFolderName} or ${expenseFolderName} folder not found`);
  const flowFolderCache = new Map<string, FolderNode | null>();

  const getFlowFolderForYear = async (year: string, flow: Flow): Promise<FolderNode | null> => {
    const key = `${year}:${flow}`;
    if (flowFolderCache.has(key)) return flowFolderCache.get(key) || null;
    const yearNode = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, year);
    if (!yearNode) {
      flowFolderCache.set(key, null);
      return null;
    }
    const flo
```
