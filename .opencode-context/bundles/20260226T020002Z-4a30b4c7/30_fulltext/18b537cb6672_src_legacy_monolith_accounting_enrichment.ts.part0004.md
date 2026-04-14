# Context Fulltext

- source_path: src/legacy/monolith/accounting_enrichment.ts
- source_sha256: c6b99240f32fa025532b02fdb300cde82b7beed9a2685d0657c505b2d0dd0e1e
- chunk: 4/4

```text
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

      if (belegeUpdates.length >= flushSize) {
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
