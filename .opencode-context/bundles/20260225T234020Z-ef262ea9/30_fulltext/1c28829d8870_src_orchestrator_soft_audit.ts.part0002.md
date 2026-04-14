# Context Fulltext

- source_path: src/orchestrator/soft_audit.ts
- source_sha256: 8116c683a9a20bef41d01bd8a7df2dc3700c507be9adb20b188af00a0d2081c2
- chunk: 2/2

```text
extractedText: raw[iExt] || '',
      ocrText: raw[iOcr] || '',
      imageDescription: raw[iImg] || '',
      category: raw[iCat] || '',
      analyzedAt: raw[iAnalyzed] || '',
      fileUrl: raw[iUrl] || '',
      sourceFolderId: raw[iSrc] || '',
      targetFolderId: raw[iTgt] || ''
    }))
    .filter((r) => Boolean(r.driveId));

  const infoById = new Map<string, ParsedInfo>();
  for (const r of records) {
    infoById.set(r.driveId, parseRecordInfo(r));
  }

  console.log('Detect confirmation files (missing beleg)...');
  const missingCandidates = records.filter((r) => isConfirmationButNotInvoice(infoById.get(r.driveId)!));
  console.log(`Missing-beleg candidates: ${missingCandidates.length}`);

  let missingMoved = 0;
  for (const r of missingCandidates) {
    if (r.targetFolderId === MISSING_FOLDER_ID) continue;
    try {
      await driveService.moveFile(r.driveId, MISSING_FOLDER_ID);
      missingMoved++;
    } catch {
      // continue processing others
    }
  }
  console.log(`Moved to missing-belege folder: ${missingMoved}`);

  console.log(`Detect ${auditLevel} duplicates...`);
  const groups = new Map<string, BelegRow[]>();
  for (const r of records) {
    const info = infoById.get(r.driveId)!;
    const amountKey = info.amount !== undefined ? Math.round(info.amount * 100).toString() : 'na';
    const dateKey = info.date || 'na';
    const nameKey = info.normalizedName.split(' ').slice(0, 4).join(' ');
    const key = `${amountKey}|${dateKey}|${nameKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const duplicateIds = new Set<string>();
  const duplicateReport: DuplicateReportRow[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.driveId.localeCompare(b.driveId));
    const leader = sorted[0];
    const matches: BelegRow[] = [leader];
    for (let i = 1; i < sorted.length; i++) {
      const candidate = sorted[i];
      const duplicateOfAny = matches.some((m) => isSoftDuplicate(
        m,
        candidate,
        infoById.get(m.driveId)!,
        infoById.get(candidate.driveId)!
      ) && auditLevel === 'soft') || matches.some((m) => isHardDuplicate(
        m,
        candidate,
        infoById.get(m.driveId)!,
        infoById.get(candidate.driveId)!
      ) && auditLevel === 'hard');
      if (duplicateOfAny) {
        matches.push(candidate);
      }
    }
    if (matches.length > 1) {
      const original = chooseOriginal(matches);
      for (const m of matches) {
        if (m.driveId === original.driveId) continue;
        const oi = infoById.get(original.driveId)!;
        const mi = infoById.get(m.driveId)!;
        duplicateIds.add(m.driveId);
        duplicateReport.push({
          originalId: original.driveId,
          duplicateId: m.driveId,
          name: m.name,
          date: mi.date || oi.date || '',
          amount: mi.amount !== undefined ? mi.amount.toFixed(2) : (oi.amount !== undefined ? oi.amount.toFixed(2) : ''),
          nameSimilarity: [REDACTED]
          rule: auditLevel === 'hard' ? 'HARD(name+date+amount)' : 'SOFT(name/date/amount blend)'
        });
      }
    }
  }

  let softMoved = 0;
  const moveStatus = new Map<string, string>();
  for (const r of records) {
    if (!duplicateIds.has(r.driveId)) continue;
    if (r.targetFolderId === DUPLICATE_FOLDER_ID) {
      moveStatus.set(r.driveId, 'already_in_duplicate_folder');
      continue;
    }
    try {
      await driveService.moveFile(r.driveId, DUPLICATE_FOLDER_ID);
      softMoved++;
      moveStatus.set(r.driveId, 'moved');
    } catch {
      // keep going
      moveStatus.set(r.driveId, 'move_failed');
    }
  }
  console.log(`${auditLevel.toUpperCase()} duplicate files moved: ${softMoved}`);

  const duplicateSheetTitle = auditLevel === 'hard' ? 'Harte Duplikatpruefung' : 'Weiche Duplikatpruefung';
  await ensureSheet(sheetsApi, spreadsheetId, duplicateSheetTitle);
  const duplicateRows = [[
    'audit_level',
    'duplicate_drive_file_id',
    'original_drive_file_id',
    'name',
    'date_detected',
    'amount_detected_eur',
    'name_similarity',
    'rule',
    'move_status'
  ]];
  for (const row of duplicateReport) {
    duplicateRows.push([
      auditLevel,
      row.duplicateId,
      row.originalId,
      row.name,
      row.date,
      row.amount,
      row.nameSimilarity.toFixed(3),
      row.rule,
      moveStatus.get(row.duplicateId) || 'not_moved'
    ]);
  }
  await sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: `${duplicateSheetTitle}!A:Z` });
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${duplicateSheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: duplicateRows }
  });

  const removeIds = new Set<string>([...duplicateIds, ...missingCandidates.map((r) => r.driveId)]);
  const remaining = rows.slice(1).filter((raw) => !removeIds.has(raw[iDrive] || ''));
  await sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: 'belege!A2:Z' });
  if (remaining.length > 0) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: 'belege!A2',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: remaining }
    });
  }
  console.log(`Removed from belege: ${removeIds.size}`);

  console.log('Sync "Fehlende Belege" tab...');
  const missingSheetTitle = 'Fehlende Belege';
  await ensureSheet(sheetsApi, spreadsheetId, missingSheetTitle);

  const missingFiles = await driveService.listFilesRecursive(MISSING_FOLDER_ID);
  const rowByDriveId = new Map(records.map((r) => [r.driveId, r]));
  const missingValues = [[
    'AuswahlKey',
    'drive_file_id',
    'original_name',
    'date_detected',
    'amount_detected',
    'reason',
    'status',
    'file_url'
  ]];

  for (const file of missingFiles) {
    const existing = rowByDriveId.get(file.id);
    const info = existing ? infoById.get(existing.driveId)! : parseRecordInfo({
      raw: [],
      driveId: file.id,
      name: file.name,
      fileSize: Number.parseInt(file.size || '0', 10),
      extractedText: '',
      ocrText: '',
      imageDescription: '',
      category: '',
      analyzedAt: '',
      fileUrl: file.webViewLink || '',
      sourceFolderId: '',
      targetFolderId: ''
    });

    const selectionKey = `${file.name} | ${file.id}`;
    missingValues.push([
      selectionKey,
      file.id,
      file.name,
      info.date || '',
      info.amount !== undefined ? info.amount.toFixed(2) : '',
      'Keine anerkannte Rechnung/Quittung erkannt (z.B. Bestell-/Lieferbestätigung)',
      'OFFEN',
      file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    ]);
  }

  await sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: `${missingSheetTitle}!A:Z` });
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${missingSheetTitle}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: missingValues }
  });

  console.log('Build "Eigenbeleg" template sheet...');
  const eigenbelegSheetId = await ensureSheet(sheetsApi, spreadsheetId, 'Eigenbeleg');

  const templateRows = [
    ['EIGENBELEG (Vorlage)'],
    ['Wichtig: Diese Vorlage ist eine technische Unterstützung und ersetzt keine individuelle steuerliche/rechtliche Beratung.'],
    [],
    ['Auswahl fehlender Beleg', ''],
    ['Erstellt am', '=TODAY()'],
    ['Referenz-Datei', '=IF($B$4=\"\",\"\",INDEX(\'Fehlende Belege\'!$H:$H,MATCH($B$4,\'Fehlende Belege\'!$A:$A,0)))'],
    ['Dokumentname', '=IF($B$4=\"\",\"\",INDEX(\'Fehlende Belege\'!$C:$C,MATCH($B$4,\'Fehlende Belege\'!$A:$A,0)))'],
    ['Kaufdatum', '=IF($B$4=\"\",\"\",INDEX(\'Fehlende Belege\'!$D:$D,MATCH($B$4,\'Fehlende Belege\'!$A:$A,0)))'],
    ['Betrag (EUR)', '=IF($B$4=\"\",\"\",INDEX(\'Fehlende Belege\'!$E:$E,MATCH($B$4,\'Fehlende Belege\'!$A:$A,0)))'],
    ['Grund für Eigenbeleg', '=IF($B$4=\"\",\"\",INDEX(\'Fehlende Belege\'!$F:$F,MATCH($B$4,\'Fehlende Belege\'!$A:$A,0)))'],
    ['Lieferant/Empfänger', ''],
    ['Leistungs-/Produktbeschreibung', ''],
    ['Zahlungsart', ''],
    ['Projekt-/Kostenstellenbezug', ''],
    [],
    ['Erklärung'],
    ['Ich bestätige hiermit nach bestem Wissen, dass die oben genannte Ausgabe betrieblich veranlasst wurde und kein Originalbeleg verfügbar ist.'],
    [],
    ['Ort, Datum', ''],
    ['Unterschrift', '']
  ];

  await sheetsApi.spreadsheets.values.clear({ spreadsheetId, range: 'Eigenbeleg!A:Z' });
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: 'Eigenbeleg!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: templateRows }
  });

  const validationRequests = [
    {
      setDataValidation: {
        range: {
          sheetId: eigenbelegSheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: 2
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: `='Fehlende Belege'!A2:A` }]
          },
          strict: true,
          showCustomUi: true
        }
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: eigenbelegSheetId,
          gridProperties: {
            frozenRowCount: 3
          }
        },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: eigenbelegSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 2
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 14 }
          }
        },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: eigenbelegSheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: 1
        },
        properties: { pixelSize: 260 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: eigenbelegSheetId,
          dimension: 'COLUMNS',
          startIndex: 1,
          endIndex: 2
        },
        properties: { pixelSize: 620 },
        fields: 'pixelSize'
      }
    }
  ];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: validationRequests }
  });

  console.log('Sync per-folder tabs under accounting root...');
  const syncedFolderTabs = await syncFolderTabs(driveApi, sheetsApi, spreadsheetId, ACCOUNTING_ROOT_FOLDER_ID);

  console.log(`${auditLevel.toUpperCase()} audit complete`);
  console.log(JSON.stringify({
    auditLevel,
    softDuplicateIds: duplicateIds.size,
    softMoved,
    missingCandidates: missingCandidates.length,
    missingMoved,
    belegeRemaining: remaining.length,
    missingSheetRows: missingValues.length - 1,
    duplicateSheetRows: duplicateRows.length - 1,
    syncedFolderTabs
  }, null, 2));
}

withPipelineLock('soft_audit', main).catch((error) => {
  console.error('Soft audit failed:', error);
  process.exit(1);
});

```
