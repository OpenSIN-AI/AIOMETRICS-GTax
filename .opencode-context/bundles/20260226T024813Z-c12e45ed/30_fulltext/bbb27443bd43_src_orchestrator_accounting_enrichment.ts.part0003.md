# Context Fulltext

- source_path: src/orchestrator/accounting_enrichment.ts
- source_sha256: 65bdc2911fce09bd90e1b1758d81ff4c4799cb3d30880dcdeece1d5deca046f2
- chunk: 3/3

```text
= '';

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
        if (desired && row.targetFolderId !== desired) {
          try {
            await runWithRateLimitRetry(
              () => driveService.moveFile(row.driveFileId, desired),
              `moveRules.${row.driveFileId}`
            );
          } catch (moveErr) {
            console.warn(`Rule move failed for ${row.driveFileId}: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`);
          }
        }
      }

      const metadataObject = {
        accounting_version: 1,
        extraction_status: extractionStatus,
        extraction_note: extractionNote,
        supplier: parsed.lieferant,
        invoice_no: parsed.belegnr,
        invoice_date: parsed.belegdatum,
        vat_19: parsed.mwst19,
        vat_7: parsed.mwst7,
        vat_0: parsed.mwst0,
        gross_total: parsed.bruttoGesamt,
        net_total: parsed.nettoGesamt,
        tax_category: parsed.steuerkategorie,
        sollkonto: parsed.sollkonto,
        habenkonto: parsed.habenkonto,
        status: parsed.status
      };

      belegeUpdates.push({
        range: `belege!G${row.rowNumber}:K${row.rowNumber}`,
        values: [[
          clampText(extracted || '', 45000),
          clampText(ocr || '', 45000),
          '',
          '',
          JSON.stringify(metadataObject)
        ]]
      });

      if (belegeUpdates.length >= 50) {
        await flushBelegeUpdates();
      }
      belegeUpdateCount++;

      existingByDriveId.set(row.driveFileId, [
        row.driveFileId,
        row.fileUrl,
        row.originalName,
        renamed,
        parsed.belegart,
        parsed.lieferant,
        parsed.kunde,
        parsed.belegnr,
        parsed.belegId,
        parsed.belegdatum,
        parsed.leistungsdatum,
        parsed.steuerkategorie,
        parsed.mwst19.toFixed(2),
        parsed.mwst7.toFixed(2),
        parsed.mwst0.toFixed(2),
        parsed.nettoGesamt.toFixed(2),
        parsed.bruttoGesamt.toFixed(2),
        parsed.geschaeftlicheMwst.toFixed(2),
        parsed.privateMwst.toFixed(2),
        parsed.geschaeftlicherAnteilBrutto.toFixed(2),
        parsed.privaterAnteilBrutto.toFixed(2),
        parsed.sollkonto,
        parsed.habenkonto,
        parsed.iban,
        parsed.bic,
        parsed.bankleitzahl,
        parsed.hinweis,
        parsed.duplicateGroup,
        parsed.status,
        parsed.lineItemsJson,
        row.sourceFolderId,
        row.targetFolderId,
        nowIso
      ]);

      if (done % 20 === 0 || done === pending.length) {
        console.log(`Processed ${done}/${pending.length}`);
      }
    }

    await flushBelegeUpdates();

    const belegeIdSet = new Set(belegeRows.map((row) => row.driveFileId));
    const finalRows = Array.from(existingByDriveId.entries())
      .filter(([driveId]) => belegeIdSet.has(driveId))
      .map(([, value]) => value)
      .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
    await runWithRateLimitRetry(
      () => sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${dbSheetTitle}!A:ZZ`
      }),
      'db.clear'
    );
    await runWithRateLimitRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${dbSheetTitle}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [dbHeaders, ...finalRows] }
      }),
      'db.update'
    );

    await runWithRateLimitRetry(
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: dbSheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: dbSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: dbHeaders.length
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
                    sheetId: dbSheetId,
                    startRowIndex: 0,
                    endRowIndex: Math.max(1, finalRows.length + 1),
                    startColumnIndex: 0,
                    endColumnIndex: dbHeaders.length
                  }
                }
              }
            }
          ]
        }
      }),
      'db.format'
    );

    console.log(JSON.stringify({
      totalBelege: belegeRows.length,
      processedThisRun: pending.length,
      dbRows: finalRows.length,
      belegeUpdated: belegeUpdateCount
    }, null, 2));
  } finally {
    if (worker) {
      await worker.terminate();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

withPipelineLock('accounting_enrichment', main).catch((error) => {
  console.error('accounting_enrichment failed:', error);
  process.exit(1);
});

```
