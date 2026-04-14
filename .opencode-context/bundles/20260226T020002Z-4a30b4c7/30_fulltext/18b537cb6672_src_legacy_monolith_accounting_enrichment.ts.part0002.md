# Context Fulltext

- source_path: src/legacy/monolith/accounting_enrichment.ts
- source_sha256: c6b99240f32fa025532b02fdb300cde82b7beed9a2685d0657c505b2d0dd0e1e
- chunk: 2/4

```text
r\.?|#)|invoice(?:\s*no\.?|\s*number)?|beleg(?:nr\.?|nummer)?)\s*[:#]?\s*([A-Z0-9\-\/\.]{4,})/i,
    /\b([A-Z]{1,4}-\d{3,})\b/,
    /\b(\d{6,})\b/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1].slice(0, 80);
  }
  return '';
}

function detectIban(text: string): string {
  const m = text.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/i);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function detectBic(text: string): string {
  const m = text.match(/\b([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/);
  return m ? m[1] : '';
}

function detectCustomer(text: string): string {
  const m = text.match(/(?:kunde|customer|an)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .,&-]{3,80})/i);
  return m ? m[1].trim() : '';
}

function extractVatAmount(text: string, rate: '19' | '7' | '0'): number {
  const m = text.match(new RegExp(`(?:mwst|ust|umsatzsteuer|mehrwertsteuer)[^\\n\\r]{0,40}${rate}\\s*%[^\\d]{0,10}([\\d.,]{1,20})`, 'i'));
  return m ? parseAmount(m[1]) : 0;
}

function extractGross(text: string): number {
  const patterns = [
    /(?:gesamt(?:betrag)?|summe|zahlbetrag|brutto)[^\d]{0,20}([\d.,]{1,20})/i,
    /(?:total)[^\d]{0,20}([\d.,]{1,20})/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseAmount(m[1]);
  }
  return 0;
}

function extractNet(text: string): number {
  const m = text.match(/(?:netto(?:betrag)?|net amount)[^\d]{0,20}([\d.,]{1,20})/i);
  return m ? parseAmount(m[1]) : 0;
}

function classifySteuerkategorie(text: string): string {
  const lower = text.toLowerCase();
  if (FUEL_KEYWORDS.some((k) => lower.includes(k))) return 'Kraftstoff/Benzin';
  if (lower.includes('bewirt') || lower.includes('restaurant') || lower.includes('lieferando') || lower.includes('wolt')) return 'Bewirtung';
  if (lower.includes('strom') || lower.includes('vattenfall') || lower.includes('energie')) return 'Strom/Energie';
  if (lower.includes('ionos') || lower.includes('1&1') || lower.includes('hosting') || lower.includes('domain')) return 'IT/Hosting';
  if (lower.includes('miete')) return 'Miete';
  if (lower.includes('versicherung') || lower.includes('hdi')) return 'Versicherung';
  return 'Sonstiges';
}

function detectBelegart(text: string, supplier: string, customer: string): BelegArt {
  const lower = `${text}\n${supplier}\n${customer}`.toLowerCase();
  const ownIssuer = lower.includes('zoe') || lower.includes('jeremy schulze');
  if (ownIssuer && lower.includes('rechnung')) return 'Einnahme';
  if (lower.includes('gutschrift') && ownIssuer) return 'Einnahme';
  if (INVOICE_KEYWORDS.some((k) => lower.includes(k))) return 'Ausgabe';
  return 'Unklar';
}

function computePrivateSplit(text: string, brutto: number, mwst19: number, mwst7: number): {
  businessGross: number;
  privateGross: number;
  businessVat: number;
  privateVat: number;
  hint: string;
} {
  const lower = text.toLowerCase();
  const fuel = FUEL_KEYWORDS.some((k) => lower.includes(k));
  const mixed = PRIVATE_MIXED_KEYWORDS.some((k) => lower.includes(k));
  if (!fuel || !mixed || brutto <= 0) {
    return {
      businessGross: brutto,
      privateGross: 0,
      businessVat: mwst19 + mwst7,
      privateVat: 0,
      hint: ''
    };
  }

  const fuelLineMatch = text.match(/(?:super|diesel|benzin|kraftstoff)[^\d]{0,20}([\d.,]{1,20})/i);
  const fuelAmount = fuelLineMatch ? parseAmount(fuelLineMatch[1]) : brutto * 0.7;
  const businessGross = Math.max(0, Math.min(brutto, fuelAmount));
  const privateGross = Math.max(0, brutto - businessGross);
  const totalVat = mwst19 + mwst7;
  const businessVat = brutto > 0 ? totalVat * (businessGross / brutto) : totalVat;
  const privateVat = Math.max(0, totalVat - businessVat);
  return {
    businessGross,
    privateGross,
    businessVat,
    privateVat,
    hint: 'Mischbeleg erkannt (Kraftstoff + private Positionen). Bitte manuell pruefen.'
  };
}

function mapAccounts(belegart: BelegArt, steuerkategorie: string, mwst19: number, mwst7: number, mwst0: number): {
  soll: string;
  haben: string;
} {
  if (belegart === 'Einnahme') {
    let haben = '8400';
    if (mwst0 > 0 || (mwst19 === 0 && mwst7 === 0)) haben = '8290'; // SKR03: Erlöse 0% USt (z.B. PV-Nullsteuersatz)
    else if (mwst7 > 0) haben = '8300';
    return { soll: '1200', haben };
  }

  if (steuerkategorie === 'Kraftstoff/Benzin') return { soll: '4530', haben: '1200' };
  if (steuerkategorie === 'Bewirtung') return { soll: '4650', haben: '1200' };
  if (steuerkategorie === 'IT/Hosting') return { soll: '4930', haben: '1200' };
  if (steuerkategorie === 'Strom/Energie') return { soll: '4250', haben: '1200' };
  if (steuerkategorie === 'Miete') return { soll: '4210', haben: '1200' };
  return { soll: '4980', haben: '1200' };
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:\"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function buildUnifiedFilename(doc: ParsedDoc, originalName: string): string {
  const ext = path.extname(originalName) || '.pdf';
  const date = doc.belegdatum || '0000-00-00';
  const supplier = sanitizeFilename(doc.lieferant || 'Unbekannt');
  const no = sanitizeFilename(doc.belegnr || doc.belegId || 'ohneNummer');
  const gross = doc.bruttoGesamt > 0 ? `${doc.bruttoGesamt.toFixed(2)}EUR` : 'BetragUnbekannt';
  const type = doc.belegart === 'Einnahme' ? 'Einnahme' : 'Ausgabe';
  return `${date}_${type}_${supplier}_${no}_${gross}${ext}`.slice(0, 180);
}

function shouldMoveToPrivate(text: string, supplier: string, doc: ParsedDoc): boolean {
  const lower = `${text}\n${supplier}`.toLowerCase();
  if (PRIVATE_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (doc.belegart === 'Ausgabe' && doc.mwst0 > 0) return true;
  return false;
}

function shouldMoveToArchive(text: string, supplier: string): boolean {
  const lower = `${text}\n${supplier}`.toLowerCase();
  if (ARCHIVE_KEYWORDS.some((k) => lower.includes(k))) return true;
  if ((lower.includes('ionos') || lower.includes('1&1')) && !INVOICE_KEYWORDS.some((k) => lower.includes(k))) return true;
  return false;
}

async function ensureSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<number> {
  const ss = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  });
  const existing = (ss.data.sheets || []).find((s) => s.properties?.title === title);
  const existingSheetId = existing?.properties?.sheetId;
  if (typeof existingSheetId === 'number') return existingSheetId;
  const create = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Failed to create sheet ${title}`);
  return id;
}

async function getBelegeRows(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<BelegeRow[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'belege'
  });
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);
  const iId = idx('id');
  const iDrive = idx('drive_file_id');
  const iName = idx('original_name');
  const iMime = idx('mime_type');
  const iSrc = idx('source_folder_id');
  const iTgt = idx('target_folder_id');
  const iUrl = idx('file_url');
  const iExt = idx('extracted_text');
  const iOcr = idx('ocr_text');
  const iMeta = idx('metadata');

  const rows: BelegeRow[] = [];
  values.slice(1).forEach((row, index) => {
    rows.push({
      rowNumber: index + 2,
      id: row[iId] || '',
      driveFileId: row[iDrive] || '',
      originalName: row[iName] || '',
      mimeType: row[iMime] || '',
      sourceFolderId: row[iSrc] || '',
      targetFolderId: row[iTgt] || '',
      fileUrl: row[iUrl] || '',
      extractedText: row[iExt] || '',
      ocrText: row[iOcr] || '',
      metadata: row[iMeta] || ''
    });
  });
  return rows.filter((row) => Boolean(row.driveFileId));
}

async function getYearPriorityDriveIds(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  year: string
): Promise<Set<string>> {
  const tabs = [`Einnahmen_${year}`, `Ausgaben_${year}`];
  const ids = new Set<string>();

  for (const tab of tabs) {
    try {
      const response = await runWithRateLimitRetry(
        () => sheets.spreadsheets.values.get({
          spreadsheetId,
          range: tab
        }),
        `priorityYear.read.${tab}`
      );
      const values = response.data.values || [];
      if (values.length <= 1) continue;
      const headers = values[0];
      const iDrive = headers.indexOf('drive_file_id');
      if (iDrive < 0) continue;
      for (const row of values.slice(1)) {
        const id = row[iDrive] || '';
        if (id) ids.add(id);
      }
    } catch (error) {
      console.warn(`Priority tab read failed for ${tab}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return ids;
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const maxFiles = Number.parseInt(process.env.MAX_FILES_PER_RUN || '300', 10);
  const ocrMinTextLength = Number.parseInt(process.env.OCR_MIN_TEXT_LENGTH || '20', 10);
  const flushSize = Number.parseInt(process.env.BATCH_FLUSH_SIZE || '50', 10);
  const renameFiles = ['1', 'true', 'yes'].includes((process.env.RENAME_FILES || 'true').toLowerCase());
  const doMoves = ['1', 'true', 'yes'].includes((process.env.APPLY_MOVE_RULES || 'true').toLowerCase());
  const priorityYear = (process.env.PRIORITY_YEAR || '').trim();
  const disableOcrFallback = ['1', 'true', 'yes'].includes((process.env.DISABLE_OCR_FALLBACK || 'false').toLowerCase());
  const enableQwenFallback = ['1', 'true', 'yes'].includes((process.env.ENABLE_QWEN_FALLBACK || 'true').toLowerCase());

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });
  const driveService = new GoogleDriveService(credentialsPath);

  const dbSheetTitle = 'Buchhaltung_DB';
  const dbSheetId = await ensureSheet(sheets, spreadsheetId, dbSheetTitle);

  const dbHeaders = [
    'drive_file_id',
    'file_url',
    'dateiname_original',
    'dateiname_standardisiert',
    'belegart',
    'lieferant',
    'kunde',
    'belegnr',
    'beleg_id',
    'belegdatum',
    'leistungsdatum',
    'steuerkategorie',
    'mwst_19_betrag',
    'mwst_7_betrag',
    'mwst_0_betrag',
    'netto_gesamt',
    'brutto_gesamt',
    'geschaeftliche_mwst',
    'private_mwst',
    'geschaeftlicher_anteil_brutto',
    'privater_anteil_brutto',
    'sollkonto',
    'habenkonto',
    'iban',
    'bic',
    'bankleitzahl',
    'hinweis',
    'duplikat_gruppe',
    'status',
    'line_items_json',
    'source_folder_id',
    'target_folder_id',
    'analyzed_at'
  ];

  const existingDb = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${dbSheetTitle}`
  });
  const dbRows = existingDb.data.values || [];
  const existingByDriveId = new Map<string, string[]>();
  if (dbRows.length > 1) {
    for (const row of dbRows.slice(1)) {
      const driveId = row[0] || '';
      if (driveId) existingByDriveId.set(driveId, row);
    }
  }

  const belegeRows = await getBelegeRows(sheets, spreadsheetId);
  const priorityIds = priorityYear ? await getYearPriorityDriveIds(sheets, spreadsheetId, priorityYear) : new Set<string>();
  for (const row of belegeRows) {
    if (existingByDriveId.has(row.driveFileId)) continue;
    existingByDriveId.set(row.driveFileId, [
      row.driveFileId,
      row.fil
```
