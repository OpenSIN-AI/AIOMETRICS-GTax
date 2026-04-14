# Context Fulltext

- source_path: src/orchestrator/run_eigenbeleg_pipeline.ts
- source_sha256: ae38df91ba9833dcde76734e41d7f0abdddc1bd87d4e1f2db6fb54ac004e9099
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import sharp from 'sharp';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const EIGENBELEGE_FOLDER_ID = process.env.EIGENBELEGE_FOLDER_ID || '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const NEUE_BELEGE_FOLDER_ID = process.env.NEUE_BELEGE_FOLDER_ID || '';

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

function must(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

async function findFolderIdByName(name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const exact = await drive.files.list({
    q: `'${ACCOUNTING_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/'/g, "\\'")}'`,
    fields: 'files(id,name)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  if (exact.data.files?.[0]?.id) return exact.data.files[0].id;

  const loose = await drive.files.list({
    q: `'${ACCOUNTING_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '${escaped}'`,
    fields: 'files(id,name)',
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const file = (loose.data.files || []).find((f) => (f.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return file?.id || loose.data.files?.[0]?.id || null;
}

async function getSheetIdByTitle(title: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)'
  });
  const s = (meta.data.sheets || []).find((x) => x.properties?.title === title);
  if (!s?.properties?.sheetId && s?.properties?.sheetId !== 0) throw new Error(`Sheet ${title} not found`);
  return s.properties.sheetId;
}

async function readEigenbelegSelection(): Promise<{ selectedId: string; runFlag: string }> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbeleg!B2:B19'
  });
  const values = r.data.values || [];
  return {
    selectedId: String(values[0]?.[0] || '').trim(),
    runFlag: String(values[17]?.[0] || '').trim().toUpperCase()
  };
}

async function readEigenbelegeRowById(fileId: string): Promise<{ rowIndex: number; fileName: string }> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbelege!A1:H'
  });
  const rows = r.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === fileId) {
      return { rowIndex: i + 1, fileName: String(rows[i][1] || fileId) };
    }
  }
  throw new Error(`Selected drive_file_id not found in Eigenbelege: ${fileId}`);
}

async function exportEigenbelegSheetPdf(targetPath: string): Promise<void> {
  const sheetId = await getSheetIdByTitle('Eigenbeleg');
  const token = [REDACTED] auth.getAccessToken();
  const accessToken = [REDACTED] token =[REDACTED] 'string' ? token : [REDACTED];
  if (!accessToken) throw new Error('No access token');

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=pdf&gid=${sheetId}&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false`;
  const resp = await fetch(url, {
    headers: [REDACTED]
  });
  if (!resp.ok) throw new Error(`Eigenbeleg export failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(targetPath, buf);
}

async function downloadSourceAsPdf(fileId: string, targetPath: string): Promise<void> {
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
    supportsAllDrives: true
  });
  const mime = meta.data.mimeType || '';

  if (mime === 'application/pdf') {
    const media = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(targetPath, Buffer.from(media.data as ArrayBuffer));
    return;
  }

  if (mime.startsWith('image/')) {
    throw new Error(`Unsupported source mime type for merge (image to pdf not implemented): ${mime}`);
  }

  if (mime.startsWith('application/vnd.google-apps')) {
    const exp = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    fs.writeFileSync(targetPath, Buffer.from(exp.data as ArrayBuffer));
    return;
  }

  throw new Error(`Unsupported source mime type for merge: ${mime}`);
}

function mergePdfs(pdfA: string, pdfB: string, outPdf: string): void {
  const result = spawnSync('/opt/homebrew/bin/pdfunite', [pdfA, pdfB, outPdf], {
    stdio: 'pipe'
  });
  if (result.status !== 0) {
    throw new Error(`pdfunite failed: ${(result.stderr || '').toString()}`);
  }
}

async function uploadMergedPdf(fileName: string, mergedPath: string, targetFolderId: string): Promise<string> {
  const resp = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetFolderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: fs.createReadStream(mergedPath)
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true
  });
  return resp.data.id || '';
}

async function replaceSourceWithMergedAndMove(
  sourceFileId: string,
  mergedName: string,
  mergedPath: string,
  targetFolderId: string
): Promise<string> {
  const meta = await drive.files.get({
    fileId: sourceFileId,
    fields: 'id,parents',
    supportsAllDrives: true
  });
  const parents = meta.data.parents || [];
  const removeParents = parents.join(',');

  const resp = await drive.files.update({
    fileId: sourceFileId,
    requestBody: {
      name: mergedName,
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: fs.createReadStream(mergedPath)
    },
    addParents: targetFolderId,
    removeParents,
    fields: 'id',
    supportsAllDrives: true
  });
  return resp.data.id || sourceFileId;
}

async function writeStatus(message: string): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbeleg!B20',
    valueInputOption: 'RAW',
    requestBody: { values: [[message]] }
  });
}

async function resetRunFlag(): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbeleg!B19',
    valueInputOption: 'RAW',
    requestBody: { values: [['']] }
  });
}

async function deleteEigenbelegeRow(rowNumber: number): Promise<void> {
  const sheetId = await getSheetIdByTitle('Eigenbelege');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber
          }
        }
      }]
    }
  });
}

async function main(): Promise<void> {
  must(SPREADSHEET_ID, 'GOOGLE_SHEET_ID');
  const { selectedId, runFlag } = await readEigenbelegSelection();
  if (!selectedId) throw new Error('Eigenbeleg!B2 is empty (no selected drive_file_id).');
  if (runFlag !== 'RUN') throw new Error('Eigenbeleg!B19 must be RUN before execution.');

  const row = await readEigenbelegeRowById(selectedId);
  const neueBelegeFolderId = NEUE_BELEGE_FOLDER_ID || (await findFolderIdByName('Neue Belege')) || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigenbeleg-'));
  const sourcePdf = path.join(tmpDir, 'source.pdf');
  const eigenbelegPdf = path.join(tmpDir, 'eigenbeleg.pdf');
  const mergedPdf = path.join(tmpDir, 'merged.pdf');

  await writeStatus('Running...');
  await downloadSourceAsPdf(selectedId, sourcePdf);
  await exportEigenbelegSheetPdf(eigenbelegPdf);
  mergePdfs(sourcePdf, eigenbelegPdf, mergedPdf);

  const mergedName = `Eigenbeleg_Merge_${row.fileName.replace(/\.[a-z0-9]{2,6}$/i, '')}.pdf`;
  let newFileId = '';
  let replacedInPlace = false;
  try {
    newFileId = await uploadMergedPdf(mergedName, mergedPdf, neueBelegeFolderId);
    await drive.files.delete({ fileId: selectedId, supportsAllDrives: true });
  } catch (e: any) {
    const quotaExceeded = String(e?.message || '').includes('storage quota') || String(e?.message || '').includes('storageQuotaExceeded');
    if (!quotaExceeded) throw e;
    newFileId = await replaceSourceWithMergedAndMove(selectedId, mergedName, mergedPdf, neueBelegeFolderId);
    replacedInPlace = true;
  }
  await deleteEigenbelegeRow(row.rowIndex);
  await resetRunFlag();
  await writeStatus(`OK: merged file ${newFileId}${replacedInPlace ? ' (replaced source in-place due quota)' : ''}`);

  console.log(JSON.stringify({
    status: 'ok',
    sourceFileId: selectedId,
    mergedFileId: newFileId,
    targetFolderId: neueBelegeFolderId,
    replacedInPlace
  }, null, 2));
}

main().catch(async (e) => {
  try {
    await writeStatus(`ERROR: ${String((e as Error).message || e)}`);
  } catch {
    // ignore
  }
  console.error(e);
  process.exit(1);
});

```
