# Context Fulltext

- source_path: src/orchestrator/audit_2023_strict.ts
- source_sha256: eb76d68e34b2785053166022308f253829cffe5d78830c538de068b2723a98ad
- chunk: 2/2

```text
    out.push({
          id: childId,
          name: childName,
          mimeType: child.mimeType || '',
          size: Number.parseInt(child.size || '0', 10),
          md5Checksum: child.md5Checksum || '',
          createdTime: child.createdTime || '',
          modifiedTime: child.modifiedTime || '',
          webViewLink: child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
          parentId: child.parents?.[0] || current.id,
          path: `${current.path}/${childName}`
        });
      }
    }
  }
  return out;
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

async function readYearRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string
): Promise<YearSheetRow[]> {
  const response = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.get({ spreadsheetId, range: tab }),
    `readYearRows.${tab}`
  );
  const values = response.data.values || [];
  if (values.length <= 1) return [];
  const headers = values[0];
  const idx = (name: string): number => headers.indexOf(name);
  const iDrive = idx('drive_file_id');
  const iLieferant = idx('Lieferant');
  const iRechnungsnr = idx('Rechnungsnr');
  const iDatum = idx('Datum');
  const iBrutto = idx('Betrag_Brutto');
  const iDateiname = idx('Dateiname');
  const iMwst7 = idx('mwst_7_betrag');
  const iMwst0 = idx('mwst_0_betrag');
  return values.slice(1).map((row, i) => ({
    driveFileId: row[iDrive] || '',
    rowNumber: i + 2,
    lieferant: row[iLieferant] || '',
    rechnungsnr: row[iRechnungsnr] || '',
    datum: row[iDatum] || '',
    brutto: row[iBrutto] || '',
    dateiname: row[iDateiname] || '',
    mwst7: row[iMwst7] || '',
    mwst0: row[iMwst0] || ''
  })).filter((r) => Boolean(r.driveFileId));
}

function mkHit(file: DriveFile, db: DbRow | undefined, reason: string): Hit {
  return {
    fileId: file.id,
    name: file.name,
    reason,
    supplier: db?.lieferant || '',
    invoiceNo: db?.belegnr || '',
    date: db?.belegdatum || '',
    gross: db?.brutto_gesamt || '',
    path: file.path
  };
}

async function main(): Promise<void> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');

  const auth = new JWT({
    keyFile: [REDACTED]
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  });
  const driveApi = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const yearFolder = await findFolderByName(driveApi, ACCOUNTING_ROOT_FOLDER_ID, TARGET_YEAR);
  if (!yearFolder) throw new Error(`${TARGET_YEAR} folder not found`);
  const incomeFolder = await findFolderByName(driveApi, yearFolder.id, `Einnahmen_${TARGET_YEAR}`);
  const expenseFolder = await findFolderByName(driveApi, yearFolder.id, `Ausgaben_${TARGET_YEAR}`);
  if (!incomeFolder || !expenseFolder) throw new Error(`Einnahmen_${TARGET_YEAR} or Ausgaben_${TARGET_YEAR} folder missing`);

  const [incomeDriveFiles, expenseDriveFiles, dbRows, belegRows, incomeSheetRows, expenseSheetRows] = await Promise.all([
    listFilesRecursive(driveApi, incomeFolder.id, `${TARGET_YEAR}/Einnahmen_${TARGET_YEAR}`),
    listFilesRecursive(driveApi, expenseFolder.id, `${TARGET_YEAR}/Ausgaben_${TARGET_YEAR}`),
    readTableRows(sheetsApi, spreadsheetId, 'Buchhaltung_DB'),
    readTableRows(sheetsApi, spreadsheetId, 'belege'),
    readYearRows(sheetsApi, spreadsheetId, `Einnahmen_${TARGET_YEAR}`),
    readYearRows(sheetsApi, spreadsheetId, `Ausgaben_${TARGET_YEAR}`)
  ]);

  const dbByDriveId = new Map<string, DbRow>();
  for (const row of dbRows) {
    const id = row.drive_file_id || '';
    if (id && !dbByDriveId.has(id)) dbByDriveId.set(id, row);
  }
  const belegeByDriveId = new Map<string, BelegeRow>();
  for (const row of belegRows) {
    const id = row.drive_file_id || '';
    if (id && !belegeByDriveId.has(id)) belegeByDriveId.set(id, row);
  }

  const incomeDriveIds = new Set(incomeDriveFiles.map((f) => f.id));
  const expenseDriveIds = new Set(expenseDriveFiles.map((f) => f.id));
  const incomeSheetIds = new Set(incomeSheetRows.map((r) => r.driveFileId));
  const expenseSheetIds = new Set(expenseSheetRows.map((r) => r.driveFileId));

  const incomeDriveOnly = incomeDriveFiles.filter((f) => !incomeSheetIds.has(f.id));
  const incomeSheetOnly = incomeSheetRows.filter((r) => !incomeDriveIds.has(r.driveFileId));
  const expenseDriveOnly = expenseDriveFiles.filter((f) => !expenseSheetIds.has(f.id));
  const expenseSheetOnly = expenseSheetRows.filter((r) => !expenseDriveIds.has(r.driveFileId));

  const privateHits: Hit[] = [];
  const archiveHits: Hit[] = [];
  const confirmationHits: Hit[] = [];
  const incomeMisfiledHits: Hit[] = [];
  const vat7Hits: Hit[] = [];
  const vat0Hits: Hit[] = [];
  const yearMismatchHits: Hit[] = [];

  const byMd5 = new Map<string, DriveFile[]>();
  const byBusiness = new Map<string, DriveFile[]>();

  for (const file of expenseDriveFiles) {
    const db = dbByDriveId.get(file.id);
    const beleg = belegeByDriveId.get(file.id);
    const probe = normalizeProbe([
      file.name,
      db?.lieferant || '',
      db?.belegnr || '',
      db?.steuerkategorie || '',
      db?.hinweis || '',
      db?.belegart || '',
      db?.kunde || '',
      beleg?.original_name || '',
      beleg?.category || '',
      (beleg?.ocr_text || '').slice(0, 4000),
      (beleg?.extracted_text || '').slice(0, 4000)
    ]);
    const hasFuel = FUEL_KEYWORDS.some((k) => probe.includes(k));
    const hasPrivateItem = PRIVATE_ITEM_KEYWORDS.some((k) => probe.includes(k));

    if (!hasFuel && (PRIVATE_KEYWORDS.some((k) => probe.includes(k)) || hasPrivateItem)) {
      privateHits.push(mkHit(file, db, 'private_marker'));
    }
    if (ARCHIVE_KEYWORDS.some((k) => probe.includes(k))) {
      archiveHits.push(mkHit(file, db, 'archive_marker'));
    }
    if (hasConfirmationNoInvoice(probe)) {
      confirmationHits.push(mkHit(file, db, 'confirmation_without_invoice'));
    }
    if (desiredFlowFromSignals(file, db, beleg, 'Ausgaben') === 'Einnahmen') {
      incomeMisfiledHits.push(mkHit(file, db, 'looks_like_income'));
    }

    const vat7 = parseAmount(db?.mwst_7_betrag || '');
    const vat0 = parseAmount(db?.mwst_0_betrag || '');
    if (!hasFuel && vat7 > 0) vat7Hits.push(mkHit(file, db, 'mwst_7_present'));
    if (!hasFuel && vat0 > 0) vat0Hits.push(mkHit(file, db, 'mwst_0_present'));

    const inferredYear = inferDocumentYear(file, db, beleg);
    if (inferredYear && inferredYear !== TARGET_YEAR) {
      yearMismatchHits.push(mkHit(file, db, `year_mismatch_${inferredYear}`));
    }

    if (file.md5Checksum) {
      const key = `md5:${file.md5Checksum}`;
      const arr = byMd5.get(key) || [];
      arr.push(file);
      byMd5.set(key, arr);
    }
    const businessKey = toBusinessKey(db);
    if (businessKey) {
      const arr = byBusiness.get(businessKey) || [];
      arr.push(file);
      byBusiness.set(businessKey, arr);
    }
  }

  const duplicateMd5Groups = [...byMd5.values()].filter((g) => g.length > 1);
  const duplicateBusinessGroups = [...byBusiness.values()].filter((g) => g.length > 1);

  const report: string[] = [];
  report.push(`# AUDIT ${TARGET_YEAR} STRICT`);
  report.push('');
  report.push(`- Zeitstempel: ${new Date().toISOString()}`);
  report.push(`- Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  report.push(`- Einnahmen Folder: ${incomeFolder.id}`);
  report.push(`- Ausgaben Folder: ${expenseFolder.id}`);
  report.push('');
  report.push('## Sync');
  report.push('');
  report.push(`- Einnahmen Drive: ${incomeDriveFiles.length} | Sheet: ${incomeSheetRows.length} | DriveOnly: ${incomeDriveOnly.length} | SheetOnly: ${incomeSheetOnly.length}`);
  report.push(`- Ausgaben Drive: ${expenseDriveFiles.length} | Sheet: ${expenseSheetRows.length} | DriveOnly: ${expenseDriveOnly.length} | SheetOnly: ${expenseSheetOnly.length}`);
  report.push('');
  report.push('## Ausgaben Verstöße (Drive-basiert)');
  report.push('');
  report.push(`- Private Marker: ${privateHits.length}`);
  report.push(`- Archiv Marker: ${archiveHits.length}`);
  report.push(`- Nur Bestell/Lieferbestätigung: ${confirmationHits.length}`);
  report.push(`- Einnahme-verdächtig (Zoe/Jeremy/Abschlagsrechnung): ${incomeMisfiledHits.length}`);
  report.push(`- MwSt 7% vorhanden: ${vat7Hits.length}`);
  report.push(`- MwSt 0% vorhanden: ${vat0Hits.length}`);
  report.push(`- Jahr != ${TARGET_YEAR}: ${yearMismatchHits.length}`);
  report.push(`- Duplikatgruppen md5: ${duplicateMd5Groups.length}`);
  report.push(`- Duplikatgruppen Business-Key: ${duplicateBusinessGroups.length}`);
  report.push('');

  const top = (title: string, hits: Hit[]): void => {
    if (hits.length === 0) return;
    report.push(`### ${title} (Top 100)`);
    report.push('');
    for (const hit of hits.slice(0, 100)) {
      report.push(`- ${hit.fileId} | ${hit.name} | ${hit.reason} | ${hit.supplier} | ${hit.date} | ${hit.gross}`);
    }
    report.push('');
  };

  top('Private Marker', privateHits);
  top('Archiv Marker', archiveHits);
  top('Bestell/Lieferbestätigungen', confirmationHits);
  top('Einnahme-verdächtig in Ausgaben', incomeMisfiledHits);
  top('MwSt 7%', vat7Hits);
  top('MwSt 0%', vat0Hits);
  top('Jahr-Mismatch', yearMismatchHits);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf8');

  const criticalViolations =
    incomeDriveOnly.length +
    incomeSheetOnly.length +
    expenseDriveOnly.length +
    expenseSheetOnly.length +
    privateHits.length +
    archiveHits.length +
    confirmationHits.length +
    incomeMisfiledHits.length +
    vat7Hits.length +
    vat0Hits.length +
    yearMismatchHits.length +
    duplicateMd5Groups.length +
    duplicateBusinessGroups.length;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    reportPath: REPORT_PATH,
    sync: {
      incomeDrive: incomeDriveFiles.length,
      incomeSheet: incomeSheetRows.length,
      incomeDriveOnly: incomeDriveOnly.length,
      incomeSheetOnly: incomeSheetOnly.length,
      expenseDrive: expenseDriveFiles.length,
      expenseSheet: expenseSheetRows.length,
      expenseDriveOnly: expenseDriveOnly.length,
      expenseSheetOnly: expenseSheetOnly.length
    },
    expenseViolations: {
      privateHits: privateHits.length,
      archiveHits: archiveHits.length,
      confirmationHits: confirmationHits.length,
      incomeMisfiledHits: incomeMisfiledHits.length,
      vat7Hits: vat7Hits.length,
      vat0Hits: vat0Hits.length,
      yearMismatchHits: yearMismatchHits.length,
      duplicateMd5Groups: duplicateMd5Groups.length,
      duplicateBusinessGroups: duplicateBusinessGroups.length
    },
    criticalViolations,
    zeroErrorStrict: criticalViolations === 0
  }, null, 2));
}

main().catch((error) => {
  console.error(`audit_${TARGET_YEAR}_strict failed:`, error);
  process.exit(1);
});

```
