# Context Fulltext

- source_path: src/orchestrator/accounting_enrichment.ts
- source_sha256: 65bdc2911fce09bd90e1b1758d81ff4c4799cb3d30880dcdeece1d5deca046f2
- chunk: 2/3

```text
egdatum || '0000-00-00';
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

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const maxFiles = Number.parseInt(process.env.MAX_FILES_PER_RUN || '300', 10);
  const ocrMinTextLength = Number.parseInt(process.env.OCR_MIN_TEXT_LENGTH || '20', 10);
  const renameFiles = ['1', 'true', 'yes'].includes((process.env.RENAME_FILES || 'true').toLowerCase());
  const doMoves = ['1', 'true', 'yes'].includes((process.env.APPLY_MOVE_RULES || 'true').toLowerCase());

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
  for (const row of belegeRows) {
    if (existingByDriveId.has(row.driveFileId)) continue;
    existingByDriveId.set(row.driveFileId, [
      row.driveFileId,
      row.fileUrl,
      row.originalName,
      row.originalName,
      'Unklar',
      '',
      '',
      '',
      row.id || row.driveFileId,
      '',
      '',
      '',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'pending',
      '[]',
      row.sourceFolderId,
      row.targetFolderId,
      ''
    ]);
  }

  const pending = belegeRows.filter((row) => {
    const existing = existingByDriveId.get(row.driveFileId);
    const hasDb = Boolean(existing);
    const hasText = Boolean((row.extractedText || '').trim()) || Boolean((row.ocrText || '').trim());
    const extractionStatus = getExtractionStatusFromMetadata(row.metadata);
    const permanentlyNoText = extractionStatus === 'final_no_text';
    return !hasDb || (!hasText && !permanentlyNoText);
  }).slice(0, maxFiles);

  console.log(`Total belege: ${belegeRows.length}`);
  console.log(`Pending for enrichment this run: ${pending.length} (max ${maxFiles})`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belege-enrich-'));
  let worker: Worker | null = null;
  const belegeUpdates: sheets_v4.Schema$ValueRange[] = [];
  let belegeUpdateCount = 0;
  const nowIso = new Date().toISOString();
  const dedupeByBusinessKey = new Map<string, string>();

  const flushBelegeUpdates = async (): Promise<void> => {
    if (belegeUpdates.length === 0) return;
    for (let i = 0; i < belegeUpdates.length; i += 100) {
      const chunk = belegeUpdates.slice(i, i + 100);
      await runWithRateLimitRetry(
        () => sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: chunk
          }
        }),
        `belege.batchUpdate.${i / 100}`
      );
    }
    belegeUpdates.length = 0;
  };

  try {
    let done = 0;
    for (const row of pending) {
      done++;
      let extracted = (row.extractedText || '').trim();
      let ocr = (row.ocrText || '').trim();
      const filePath = path.join(tempDir, `${row.driveFileId}${path.extname(row.originalName) || '.bin'}`);
      let textForParse = extracted || ocr;
      const extLower = row.originalName.toLowerCase();
      const isPdf = row.mimeType === 'application/pdf' || extLower.endsWith('.pdf');
      const isImage = row.mimeType.startsWith('image/');
      let extractionStatus = 'ok';
      let extractionNote = '';

      try {
        if (!textForParse) {
          // Skip binary/unknown files where OCR/PDF extraction would be pointless.
          if (!isPdf && !isImage) {
            textForParse = '';
            extractionStatus = 'final_no_text';
            extractionNote = 'unsupported_type';
          } else {
            await runWithRateLimitRetry(
              () => driveService.downloadFile(row.driveFileId, filePath),
              `download.${row.driveFileId}`
            );
          }

          let effectivePdf = isPdf;
          let effectiveImage = isImage;
          if (fs.existsSync(filePath)) {
            const kind = detectBinaryKind(filePath);
            if (kind === 'pdf') {
              effectivePdf = true;
              effectiveImage = false;
            } else if (kind === 'image') {
              effectivePdf = false;
              effectiveImage = true;
            } else if (!effectivePdf && !effectiveImage) {
              extractionStatus = 'final_no_text';
              extractionNote = 'unsupported_binary';
            }
          }

          if (effectivePdf && fs.existsSync(filePath)) {
            let needsOcrFallback = false;
            try {
              extracted = await extractPdfText(filePath);
              textForParse = extracted;
              needsOcrFallback = !textForParse || textForParse.length < ocrMinTextLength;
            } catch (pdfExtractError) {
              console.warn(`PDF text extraction failed for ${row.driveFileId}: ${pdfExtractError instanceof Error ? pdfExtractError.message : String(pdfExtractError)}`);
              needsOcrFallback = true;
            }

            if (needsOcrFallback) {
              try {
                worker = await ensureWorker(worker);
                const pngNoExt = path.join(tempDir, `${row.driveFileId}_p1`);
                const png = await renderFirstPdfPageToPng(filePath, pngNoExt);
                ocr = await ocrWithTesseract(worker, png);
                textForParse = ocr;
              } catch (ocrError) {
                console.warn(`PDF OCR fallback failed for ${row.driveFileId}: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
              }
            }
          } else if (effectiveImage && fs.existsSync(filePath)) {
            worker = await ensureWorker(worker);
            ocr = await ocrWithTesseract(worker, filePath);
            textForParse = ocr;
          }

          if (!(textForParse || '').trim()) {
            extractionStatus = 'final_no_text';
            extractionNote = extractionNote || 'no_extractable_text';
          }
        }
      } catch (extractError) {
        console.warn(`Extraction failed for ${row.driveFileId}: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
        extractionStatus = 'final_no_text';
        extractionNote = extractionNote || 'extraction_exception';
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      const text = clampText(textForParse || '');
      const lieferant = detectSupplier(text, row.originalName.replace(/\.[a-z0-9]+$/i, ''));
      const kunde = detectCustomer(text);
      const belegnr = detectInvoiceNo(text);
      const belegdatum = toIsoDate(text);
      const leistungsdatum = belegdatum;
      const iban = detectIban(text);
      const bic = detectBic(text);
      const bankleitzahl = iban.startsWith('DE') && iban.length >= 12 ? iban.slice(4, 12) : '';
      const mwst19 = extractVatAmount(text, '19');
      const mwst7 = extractVatAmount(text, '7');
      const mwst0 = extractVatAmount(text, '0');
      const brutto = extractGross(text);
      const netto = extractNet(text);
      const steuerkategorie = classifySteuerkategorie(text);
      const belegart = detectBelegart(text, lieferant, kunde);
      const split = computePrivateSplit(text, brutto, mwst19, mwst7);
      const accounts = mapAccounts(belegart, steuerkategorie, mwst19, mwst7, mwst0);

      let hinweis = split.hint;
      let status = 'ok';
      let duplicateGroup 
```
