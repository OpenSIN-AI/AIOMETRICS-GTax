# Context Fulltext

- source_path: src/legacy/monolith/accounting_enrichment.ts
- source_sha256: c6b99240f32fa025532b02fdb300cde82b7beed9a2685d0657c505b2d0dd0e1e
- chunk: 3/4

```text
eUrl,
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
  })
    .sort((a, b) => {
      const ap = priorityIds.has(a.driveFileId) ? 1 : 0;
      const bp = priorityIds.has(b.driveFileId) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return a.rowNumber - b.rowNumber;
    })
    .slice(0, maxFiles);

  console.log(`Total belege: ${belegeRows.length}`);
  console.log(`Pending for enrichment this run: ${pending.length} (max ${maxFiles})`);
  console.log(`Flush size: ${flushSize} | disable OCR fallback: ${disableOcrFallback}`);
  console.log(`Qwen fallback enabled: ${enableQwenFallback}`);
  if (priorityYear) {
    const priorityPending = pending.filter((row) => priorityIds.has(row.driveFileId)).length;
    console.log(`Priority year ${priorityYear}: ${priorityIds.size} ids, ${priorityPending} in current batch`);
  }

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
            let qwenImagePath = '';
            try {
              extracted = await extractPdfText(filePath);
              textForParse = extracted;
              needsOcrFallback = !textForParse || textForParse.length < ocrMinTextLength;
            } catch (pdfExtractError) {
              console.warn(`PDF text extraction failed for ${row.driveFileId}: ${pdfExtractError instanceof Error ? pdfExtractError.message : String(pdfExtractError)}`);
              needsOcrFallback = true;
            }

            if (needsOcrFallback && !disableOcrFallback) {
              try {
                worker = await ensureWorker(worker);
                const pngNoExt = path.join(tempDir, `${row.driveFileId}_p1`);
                const png = await renderFirstPdfPageToPng(filePath, pngNoExt);
                qwenImagePath = png;
                ocr = await ocrWithTesseract(worker, png);
                textForParse = ocr;
              } catch (ocrError) {
                console.warn(`PDF OCR fallback failed for ${row.driveFileId}: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
              }
            }

            const needsQwenFallback = shouldUseQwenFallback(textForParse, ocrMinTextLength);
            if (needsQwenFallback && enableQwenFallback) {
              try {
                if (!qwenImagePath) {
                  const pngNoExt = path.join(tempDir, `${row.driveFileId}_p1_qwen`);
                  qwenImagePath = await renderFirstPdfPageToPng(filePath, pngNoExt);
                }
                const qwenText = await ocrWithQwenFallback(qwenImagePath);
                if (qwenText) {
                  ocr = qwenText;
                  textForParse = qwenText;
                  extractionStatus = 'ok';
                  extractionNote = extractionNote || 'qwen_fallback_used';
                }
              } catch (qwenError) {
                console.warn(`Qwen fallback failed for ${row.driveFileId}: ${qwenError instanceof Error ? qwenError.message : String(qwenError)}`);
              }
            }
          } else if (effectiveImage && fs.existsSync(filePath)) {
            if (!disableOcrFallback) {
              try {
                worker = await ensureWorker(worker);
                ocr = await ocrWithTesseract(worker, filePath);
                textForParse = ocr;
              } catch (ocrError) {
                console.warn(`Image OCR failed for ${row.driveFileId}: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
              }
            }
            const needsQwenFallback = shouldUseQwenFallback(textForParse, ocrMinTextLength);
            if (needsQwenFallback && enableQwenFallback) {
              try {
                const qwenText = await ocrWithQwenFallback(filePath);
                if (qwenText) {
                  ocr = qwenText;
                  textForParse = qwenText;
                  extractionStatus = 'ok';
                  extractionNote = extractionNote || 'qwen_fallback_used';
                }
              } catch (qwenError) {
                console.warn(`Qwen fallback failed for ${row.driveFileId}: ${qwenError instanceof Error ? qwenError.message : String(qwenError)}`);
              }
            }
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
      let duplicateGroup = '';

      const businessKey = `${lieferant.toLowerCase()}|${belegnr.toLowerCase()}|${belegdatum}|${brutto.toFixed(2)}`;
      if (lieferant && belegnr && brutto > 0) {
        const existingDup = dedupeByBusinessKey.get(businessKey);
        if (existingDup && existingDup !== row.driveFileId) {
          duplicateGroup = businessKey;
          status = 'duplicate_candidate';
          if (doMoves && row.targetFolderId !== DUPLICATE_FOLDER_ID) {
            try {
              await runWithRateLimitRetry(
                () => driveService.moveFile(row.driveFileId, DUPLICATE_FOLDER_ID),
                `moveDuplicate.${row.driveFileId}`
              );
              hinweis = `${hinweis ? `${hinweis} ` : ''}Als Duplikat erkannt und in Duplikate verschoben.`.trim();
            } catch (moveError) {
              hinweis = `${hinweis ? `${hinweis} ` : ''}Duplikatverschiebung fehlgeschlagen.`.trim();
            }
          }
        } else {
          dedupeByBusinessKey.set(businessKey, row.driveFileId);
        }
      }

      const parsed: ParsedDoc = {
        belegart,
        lieferant,
        kunde,
        belegnr,
        belegId: row.id || row.driveFileId,
        belegdatum,
        leistungsdatum,
        steuerkategorie,
        mwst19,
        mwst7,
        mwst0,
        nettoGesamt: netto,
        bruttoGesamt: brutto,
        geschaeftlicheMwst: split.businessVat,
        privateMwst: split.privateVat,
        geschaeftlicherAnteilBrutto: split.businessGross,
        privaterAnteilBrutto: split.privateGross,
        sollkonto: accounts.soll,
        habenkonto: accounts.haben,
        iban,
        bic,
        bankleitzahl,
        hinweis,
        duplicateGroup,
        status,
        lineItemsJson: '[]'
      };

      let renamed = row.originalName;
      if (renameFiles) {
        const targetName = buildUnifiedFilename(parsed, row.originalName);
        if (targetName && targetName !== row.originalName) {
          try {
            await runWithRateLimitRetry(
              () => driveApi.files.update({
                fileId: row.driveFileId,
                requestBody: { name: targetName },
                fields: 'id,name',
                supportsAllDrives: true
              }),
              `rename.${row.driveFileId}`
            );
            renamed = targetName;
          } catch (renameError) {
            console.warn(`Rename failed for ${row.driveFileId}: ${renameError instanceof Error ? renameError.message : String(renameError)}`);
          }
        }
      }

      if (doMoves) {
        const toPrivate = shouldMoveToPrivate(text, lieferant, parsed);
        const toArchive = shouldMoveToArchive(text, lieferant);
        const desired = toArchive ? ARCHIVE_FOLDER_ID : (toPrivate ? PRIVATE_FOLDER_ID : '');
   
```
