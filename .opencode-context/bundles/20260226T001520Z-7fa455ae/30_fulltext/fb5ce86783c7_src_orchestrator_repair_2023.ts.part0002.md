# Context Fulltext

- source_path: src/orchestrator/repair_2023.ts
- source_sha256: 0f706c6982ec4756cf54653e720a13104fae58266c0636c9ab698f61fe4114e9
- chunk: 2/5

```text
 ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBusinessKey(dbRow: DbRow | undefined): string {
  if (!dbRow) return '';
  const supplier = (dbRow.lieferant || '').trim().toLowerCase();
  const invoiceNo = (dbRow.belegnr || '').trim().toLowerCase();
  const date = (dbRow.belegdatum || '').trim();
  const gross = parseAmount(dbRow.brutto_gesamt || '');
  if (!supplier || !date || gross <= 0) return '';
  if (invoiceNo) {
    return `${supplier}|${invoiceNo}|${date}|${gross.toFixed(2)}`;
  }
  return `${supplier}|${date}|${gross.toFixed(2)}`;
}

type ExpenseAction = 'keep' | 'private' | 'archive' | 'missing';

function classifyExpenseAction(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): { action: ExpenseAction; reason: string } {
  const signals = [
    file.name,
    db?.lieferant || '',
    db?.steuerkategorie || '',
    db?.hinweis || '',
    db?.belegart || '',
    beleg?.category || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ];
  const probe = normalizeProbe(signals);
  const vat7 = parseAmount(db?.mwst_7_betrag || '');
  const vat0 = parseAmount(db?.mwst_0_betrag || '');
  const hasFuel = FUEL_KEYWORDS.some((k) => probe.includes(k));
  const hasPrivateItem = PRIVATE_ITEM_KEYWORDS.some((k) => probe.includes(k));

  const isIonosOr11 = probe.includes('ionos') || probe.includes('1&1') || probe.includes('1und1');
  if (isIonosOr11 && !hasInvoiceMarker(signals)) {
    return { action: 'archive', reason: 'IONOS/1&1 ohne echte Rechnung' };
  }

  if (hasConfirmationMarker(signals) && !hasInvoiceMarker(signals)) {
    return { action: 'missing', reason: 'Nur Bestell/Liefer/Kaufbestaetigung' };
  }

  if (isArchiveByKeywords(signals)) {
    return { action: 'archive', reason: 'Nicht gewerblich / Archiv-Regel' };
  }

  // Mixed fuel receipts stay in expenses; private share is handled in accounting split fields.
  if (hasFuel) {
    return { action: 'keep', reason: 'Kraftstoffbeleg (Mischpositionen werden separat gesplittet)' };
  }

  if (vat7 > 0) {
    return { action: 'private', reason: 'Ausgabe mit 7% MwSt laut Vorgabe aus Ausgaben_2023 entfernen' };
  }

  if (vat0 > 0) {
    return { action: 'private', reason: 'Ausgabe mit 0% MwSt laut Vorgabe aus Ausgaben_2023 entfernen' };
  }

  if (isPrivateByKeywords(signals)) {
    return { action: 'private', reason: 'Privat-/Konsum-Regel' };
  }

  const hasFood = hasPrivateItem || ['lebensmittel', 'supermarkt', 'getraenke', 'getränke', 'tierfutter', 'drogerie'].some((k) => probe.includes(k));
  if (hasFood) {
    return { action: 'private', reason: 'Lebensmittel/Tierfutter/Drogerie' };
  }

  return { action: 'keep', reason: '' };
}

function normalizeInvoiceToken(value: [REDACTED]
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractAmountTokens(value: [REDACTED]
  const out: string[] = [];
  const matches = value.match(/\d+[.,]\d{2}/g) || [];
  for (const m of matches) {
    const parsed = parseAmount(m);
    if (parsed > 0) out.push(parsed.toFixed(2));
  }
  return out;
}

function desiredFlowFromSignals(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined,
  currentFlow: Flow
): Flow {
  const belegart = (db?.belegart || '').toLowerCase();
  const probe = normalizeProbe([
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    beleg?.original_name || '',
    beleg?.category || '',
    db?.belegnr || '',
    db?.hinweis || '',
    db?.steuerkategorie || '',
    db?.belegdatum || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ]);
  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const salesPattern = /abschlagsrechnung|abschlagszahlung|schlussrechnung|teilrechnung|rechnungsplan|zahlung nach vertragsabschluss/.test(probe);
  const offerPattern = /angebot|pv anlage|inbetriebnahme|ac installation/.test(probe);
  const invoiceNoPattern = /\b\d{4}\.\d+\.\d+\b/.test(probe);
  const expensePattern = /ausgabe|tankstelle|kraftstoff|diesel|benzin|kassenbon|quittung|obi|bauhaus|hornbach|hellweg|lieferando|wolt|rewe|edeka|lidl|flink|myplace|miete|versicherung|strom|vattenfall/.test(probe);
  const gross = parseAmount(db?.brutto_gesamt || '');
  const hasInvoiceWord = /rechnung|invoice/.test(probe);
  const strongIncomeEvidence = salesPattern || (ownBusiness && (offerPattern || hasInvoiceWord || invoiceNoPattern));

  let incomeScore = 0;
  let expenseScore = 0;
  if (belegart.includes('einnahme')) incomeScore += 1;
  if (belegart.includes('ausgabe')) expenseScore += 1;
  if (salesPattern) incomeScore += 4;
  if (ownBusiness && offerPattern) incomeScore += 3;
  if (ownBusiness && invoiceNoPattern) incomeScore += 2;
  if (ownBusiness && hasInvoiceWord) incomeScore += 2;
  if (expensePattern) expenseScore += 4;
  if (FUEL_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (isPrivateByKeywords([probe])) expenseScore += 2;
  if (ARCHIVE_KEYWORDS.some((k) => probe.includes(k))) expenseScore += 2;
  if (gross <= 0 && !strongIncomeEvidence) incomeScore -= 1;

  if (incomeScore >= expenseScore + 2 && strongIncomeEvidence) return 'Einnahmen';
  if (expenseScore >= incomeScore + 2) return 'Ausgaben';
  if (currentFlow === 'Einnahmen' && incomeScore >= expenseScore) return 'Einnahmen';
  if (currentFlow === 'Ausgaben' && expenseScore >= incomeScore) return 'Ausgaben';
  return currentFlow;
}

function shouldMoveIncomeToExpense(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): boolean {
  const probe = normalizeProbe([
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    db?.belegnr || '',
    db?.hinweis || '',
    db?.steuerkategorie || '',
    db?.belegart || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ]);
  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const hasCustomer = Boolean((db?.kunde || '').trim());
  const hasIncomeMarkers = /abschlagsrechnung|abschlagszahlung|schlussrechnung|teilrechnung|rechnungsplan|angebot|pv anlage|inbetriebnahme|zahlung nach vertragsabschluss|rechnung|invoice/.test(probe);
  const hasExpenseMarkers = /tankstelle|kraftstoff|diesel|benzin|kassenbon|quittung|obi|bauhaus|hornbach|hellweg|lieferando|wolt|rewe|edeka|lidl|flink|myplace|miete|versicherung|strom|vattenfall|drogerie|tierfutter|lebensmittel/.test(probe);
  if (ownBusiness || hasCustomer || hasIncomeMarkers) return false;
  return hasExpenseMarkers;
}

type IncomeAction = 'keep' | 'private' | 'archive' | 'missing';

function classifyIncomeAction(
  file: DriveFile,
  db: DbRow | undefined,
  beleg: BelegeRow | undefined
): { action: IncomeAction; reason: string } {
  const signals = [
    file.name,
    db?.lieferant || '',
    db?.kunde || '',
    db?.steuerkategorie || '',
    db?.hinweis || '',
    db?.belegart || '',
    beleg?.category || '',
    beleg?.original_name || '',
    beleg?.ocr_text || '',
    beleg?.extracted_text || ''
  ];
  const probe = normalizeProbe(signals);
  const hasSalesPattern = /abschlagsrechnung|schlussrechnung|teilrechnung|rechnung/.test(probe);
  const ownBusiness = probe.includes('zoe') || probe.includes('jeremy schulze') || probe.includes('zoe solar');
  const hasCustomer = Boolean((db?.kunde || '').trim());

  if (isArchiveByKeywords(signals)) {
    return { action: 'archive', reason: 'Nicht gewerblich / Archiv-Regel' };
  }
  if (isPrivateByKeywords(signals)) {
    return { action: 'private', reason: 'Privat-/Konsum-Regel' };
  }
  if (hasConfirmationMarker(signals) && !hasInvoiceMarker(signals)) {
    return { action: 'missing', reason: 'Nur Bestell/Liefer/Kaufbestaetigung' };
  }

  // In Einnahmen nur echte Ausgangsrechnungen behalten.
  if (!hasCustomer && !ownBusiness && !hasSalesPattern) {
    return { action: 'missing', reason: 'Keine belastbare Einnahme-Rechnungssignatur' };
  }
  return { action: 'keep', reason: '' };
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason = error?.errors?.[0]?.reason || '';
      const rateLimited = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
      if (!rateLimited || attempt === maxAttempts) throw error;
      const waitMs = attempt * 2500;
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: [REDACTED]
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);
  return out;
}

async function findFolderByName(
  driveApi: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<FolderNode | null> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const response = await runWithRateLimitRetry(
    () => driveApi.files.list({
      q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    }),
    `findFolderByName.${parentId}.${name}`
  );
  const folder = (response.data.files || [])[0];
  if (!folder?.id || !folder?.name) return null;
  return { id: folder.id, name: folder.name };
}

async function listFilesRecursive(
  driveApi: drive_v3.Drive,
  folderId: string,
  pathPrefix: string
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: Array<{ id: string; path: string }> = [{ id: folderId, path: pathPrefix }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);

    const children = await listChildren(driveApi, current.id);
    for (const child of children) {
      const childId = child.id || '';
      const childName = child.name || childId;
      if (!childId) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        queue.push({ id: childId, path: `${current.path}/${childName}` });
      } else {
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

async function moveFile(driveApi: drive_v3.Drive, fileId: string, targetFolderId: string): Promise<void> {
  const current = await runWithRateLimitRetry(
    () => driveApi.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true
    }),
    `moveFile.get.${fileId}`
  );
  const previousParents = (current.data.parents || []).join(',');
  await runWithRateLimitRetry(

```
