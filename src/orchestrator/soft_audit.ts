import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleDriveService, DriveFile } from '../drive/googleDriveService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

type BelegRow = {
  raw: string[];
  driveId: string;
  name: string;
  fileSize: number;
  extractedText: string;
  ocrText: string;
  imageDescription: string;
  category: string;
  analyzedAt: string;
  fileUrl: string;
  sourceFolderId: string;
  targetFolderId: string;
};

type ParsedInfo = {
  date?: string;
  amount?: number;
  normalizedName: string;
  text: string;
};

type AuditLevel = 'soft' | 'hard';

type DuplicateReportRow = {
  originalId: string;
  duplicateId: string;
  name: string;
  date: string;
  amount: string;
  nameSimilarity: number;
  rule: string;
};

const REQUIRED_ENV = [
  'GOOGLE_CREDENTIALS_PATH',
  'GOOGLE_SHEET_ID',
  'SOURCE_DRIVE_FOLDER_ID',
  'TARGET_DRIVE_FOLDER_ID'
];

const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';

const CONFIRMATION_KEYWORDS = [
  'bestellbestätigung',
  'lieferbestätigung',
  'auftragsbestätigung',
  'kaufbestätigung',
  'order confirmation',
  'shipping confirmation',
  'purchase confirmation'
];

const INVOICE_KEYWORDS = [
  'rechnung',
  'quittung',
  'beleg',
  'invoice',
  'receipt'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function parseAmount(text: string): number | undefined {
  const candidates = text.match(/(?:€|eur|betrag|summe|gesamt)[^\d]{0,12}(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:,\d{2}))/gi) || [];
  for (const c of candidates) {
    const m = c.match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:,\d{2}))/);
    if (!m) continue;
    const numeric = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const value = Number.parseFloat(numeric);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function parseDate(text: string): string | undefined {
  const dmy = text.match(/\b([0-3]?\d)[.\-/]([01]?\d)[.\-/](20\d{2})\b/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const ymd = text.match(/\b(20\d{2})[.\-/]([01]?\d)[.\-/]([0-3]?\d)\b/);
  if (ymd) {
    const mm = ymd[2].padStart(2, '0');
    const dd = ymd[3].padStart(2, '0');
    return `${ymd[1]}-${mm}-${dd}`;
  }
  return undefined;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[0-9]+/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-zA-Zäöüß ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenJaccard(a: string, b: string): number {
  const aSet = new Set(a.split(' ').filter(Boolean));
  const bSet = new Set(b.split(' ').filter(Boolean));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection++;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function chooseOriginal(records: BelegRow[]): BelegRow {
  return [...records].sort((a, b) => {
    const aTs = Date.parse(a.analyzedAt || '');
    const bTs = Date.parse(b.analyzedAt || '');
    const aVal = Number.isFinite(aTs) ? aTs : Number.MAX_SAFE_INTEGER;
    const bVal = Number.isFinite(bTs) ? bTs : Number.MAX_SAFE_INTEGER;
    if (aVal !== bVal) return aVal - bVal;
    return a.driveId.localeCompare(b.driveId);
  })[0];
}

function parseRecordInfo(row: BelegRow): ParsedInfo {
  const combined = [row.name, row.extractedText, row.ocrText, row.imageDescription].join('\n');
  return {
    date: parseDate(combined),
    amount: parseAmount(combined),
    normalizedName: normalizeName(row.name),
    text: combined.toLowerCase()
  };
}

function isConfirmationButNotInvoice(info: ParsedInfo): boolean {
  const hasConfirmation = CONFIRMATION_KEYWORDS.some((k) => info.text.includes(k));
  const hasInvoice = INVOICE_KEYWORDS.some((k) => info.text.includes(k));
  return hasConfirmation && !hasInvoice;
}

function isSoftDuplicate(a: BelegRow, b: BelegRow, ai: ParsedInfo, bi: ParsedInfo): boolean {
  const sim = tokenJaccard(ai.normalizedName, bi.normalizedName);
  const sameDate = ai.date && bi.date && ai.date === bi.date;
  const sameAmount = ai.amount !== undefined && bi.amount !== undefined && Math.abs(ai.amount - bi.amount) < 0.01;
  const sameSize = a.fileSize > 0 && a.fileSize === b.fileSize;

  if (sameDate && sameAmount && sim >= 0.45) return true;
  if (sameAmount && sameSize && sim >= 0.65) return true;
  if (sameDate && sim >= 0.85) return true;
  return false;
}

function isHardDuplicate(a: BelegRow, b: BelegRow, ai: ParsedInfo, bi: ParsedInfo): boolean {
  const sim = tokenJaccard(ai.normalizedName, bi.normalizedName);
  const sameDate = ai.date && bi.date && ai.date === bi.date;
  const sameAmount = ai.amount !== undefined && bi.amount !== undefined && Math.abs(ai.amount - bi.amount) < 0.01;
  const sameSize = a.fileSize > 0 && a.fileSize === b.fileSize;

  // Hard mode: require date+amount and high filename similarity.
  if (!sameDate || !sameAmount) return false;
  if (sim < 0.72) return false;
  if (!sameSize && sim < 0.9) return false;
  return true;
}

async function ensureSheet(sheetsApi: any, spreadsheetId: string, title: string): Promise<number> {
  const ss = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title'
  });

  const existing = (ss.data.sheets || []).find((s: any) => s.properties?.title === title);
  if (existing?.properties?.sheetId !== undefined) {
    return existing.properties.sheetId;
  }

  const createResponse = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });

  return createResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;
}

function folderTabTitle(name: string): string {
  return `Ordner_${name}`.replace(/[\[\]\*\?\/\\]/g, '_').slice(0, 95);
}

async function listFolderChildren(driveApi: any, folderId: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: any = await driveApi.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function syncFolderTabs(
  driveApi: any,
  sheetsApi: any,
  spreadsheetId: string,
  rootFolderId: string
): Promise<number> {
  const topLevel = (await listFolderChildren(driveApi, rootFolderId))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder');

  for (const folder of topLevel) {
    const sheetTitle = folderTabTitle(folder.name || 'Unbenannt');
    const sheetId = await ensureSheet(sheetsApi, spreadsheetId, sheetTitle);

    const rows: string[][] = [[
      'drive_file_id',
      'name',
      'mime_type',
      'size',
      'modified_time',
      'file_url',
      'folder_path'
    ]];

    const queue: Array<{ id: string; path: string }> = [{ id: folder.id, path: folder.name || folder.id }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      const children = await listFolderChildren(driveApi, current.id);
      for (const child of children) {
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({
            id: child.id,
            path: `${current.path}/${child.name || child.id}`
          });
        } else {
          rows.push([
            child.id || '',
            child.name || '',
            child.mimeType || '',
            child.size || '',
            child.modifiedTime || '',
            child.webViewLink || `https://drive.google.com/file/d/${child.id}/view`,
            current.path
          ]);
        }
      }
    }

    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetTitle}!A:Z`
    });
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    });

    await sheetsApi.spreadsheets.batchUpdate({
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
                endColumnIndex: 8
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
                  endRowIndex: Math.max(1, rows.length),
                  startColumnIndex: 0,
                  endColumnIndex: 8
                }
              }
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 1,
                endIndex: 2
              },
              properties: { pixelSize: 300 },
              fields: 'pixelSize'
            }
          }
        ]
      }
    });
  }

  return topLevel.length;
}

async function main() {
  for (const name of REQUIRED_ENV) {
    mustEnv(name);
  }

  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const auditLevel: AuditLevel = (process.env.AUDIT_LEVEL || 'soft').toLowerCase() === 'hard' ? 'hard' : 'soft';

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  const sheetsApi = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });
  const driveService = new GoogleDriveService(credentialsPath);

  console.log('Load belege table...');
  const belegeResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: 'belege'
  });

  const rows = belegeResponse.data.values || [];
  if (rows.length <= 1) {
    throw new Error('belege has no data rows');
  }

  const headers = rows[0];
  const idx = (name: string) => headers.indexOf(name);

  const iDrive = idx('drive_file_id');
  const iName = idx('original_name');
  const iSize = idx('file_size');
  const iExt = idx('extracted_text');
  const iOcr = idx('ocr_text');
  const iImg = idx('image_description');
  const iCat = idx('category');
  const iAnalyzed = idx('analyzed_at');
  const iUrl = idx('file_url');
  const iSrc = idx('source_folder_id');
  const iTgt = idx('target_folder_id');

  const records: BelegRow[] = rows.slice(1)
    .map((raw) => ({
      raw,
      driveId: raw[iDrive] || '',
      name: raw[iName] || '',
      fileSize: Number.parseInt(raw[iSize] || '0', 10),
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
          nameSimilarity: tokenJaccard(oi.normalizedName, mi.normalizedName),
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
