import * as dotenv from 'dotenv';
import { google, drive_v3 } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const EIGENBELEGE_FOLDER_ID_FALLBACK = process.env.EIGENBELEGE_FOLDER_ID || '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ]
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

async function findFolderIdByName(name: string): Promise<string | null> {
  const resp = await drive.files.list({
    q: `'${ACCOUNTING_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/'/g, "\\'")}'`,
    fields: 'files(id,name)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return resp.data.files?.[0]?.id || null;
}

async function listFolderFiles(folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const resp = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime,size)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    out.push(...(resp.data.files || []));
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

function isoDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

async function ensureSheet(title: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)'
  });
  const existing = (meta.data.sheets || []).find((s) => s.properties?.title === title);
  if (existing?.properties?.sheetId != null) return existing.properties.sheetId;

  const create = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
  const id = create.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof id !== 'number') throw new Error(`Could not create sheet ${title}`);
  return id;
}

async function setupEigenbelegeSourceSheet(eigenbelegeFolderId: string): Promise<void> {
  await ensureSheet('Eigenbelege');
  const headers = [[
    'drive_file_id',
    'dateiname',
    'mime_type',
    'file_url',
    'created_date',
    'status',
    'quelle_ordner_id',
    'hinweis'
  ]];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbelege!A:Z'
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbelege!A1:H1',
    valueInputOption: 'RAW',
    requestBody: { values: headers }
  });

  const files = await listFolderFiles(eigenbelegeFolderId);
  const rows = files.map((f) => ([
    f.id || '',
    f.name || '',
    f.mimeType || '',
    f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    isoDate(f.createdTime),
    'offen',
    eigenbelegeFolderId,
    ''
  ]));

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Eigenbelege!A2:H${rows.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
  }
}

async function setupEigenbelegTemplate(): Promise<void> {
  const eigenbelegSheetId = await ensureSheet('Eigenbeleg');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbeleg!A:Z'
  });

  const template = [
    ['EIGENBELEG (Rechnungsersatz)'],
    ['Auswahl Drive-ID', ''],
    ['Dateiname', '=IF(B2="";"";XLOOKUP(B2;Eigenbelege!A:A;Eigenbelege!B:B;""))'],
    ['Datei URL', '=IF(B2="";"";XLOOKUP(B2;Eigenbelege!A:A;Eigenbelege!D:D;""))'],
    ['Datum Beleg', '=IF(B2="";"";XLOOKUP(B2;Eigenbelege!A:A;Eigenbelege!E:E;""))'],
    ['Betrag (Brutto)', ''],
    ['MwSt-Satz', '0%'],
    ['MwSt-Betrag', '0,00'],
    ['Netto', '=IF(B6="";"";B6-B8)'],
    ['Lieferant / Empfänger', ''],
    ['Leistungsbeschreibung', ''],
    ['Grund Ersatzbeleg', 'Originalrechnung fehlt / nur Bestell- oder Liefernachweis vorhanden'],
    ['Zahlungsnachweis', 'Siehe verknüpfte Ursprungsdatei'],
    ['Beleg erstellt am', '=TODAY()'],
    ['Erstellt von', 'Jeremy Schulze'],
    ['Unterschrift', '____________________________'],
    ['Status', 'bereit'],
    ['Aktion', 'Setze B19 auf \"RUN\" und starte Script run-eigenbeleg-pipeline'],
    ['RUN', ''],
    ['Ergebnis/Log', '']
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eigenbeleg!A1:B20',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: template }
  });

  // Dropdown on B2 from Eigenbelege!A2:A
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        setDataValidation: {
          range: {
            sheetId: eigenbelegSheetId,
            startRowIndex: 1,
            endRowIndex: 2,
            startColumnIndex: 1,
            endColumnIndex: 2
          },
          rule: {
            condition: {
              type: 'ONE_OF_RANGE',
              values: [{ userEnteredValue: '=Eigenbelege!A2:A' }]
            },
            strict: true,
            showCustomUi: true
          }
        }
      }]
    }
  });
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID');
  const eigenbelegeFolderId = (await findFolderIdByName('Eigenbelege')) || EIGENBELEGE_FOLDER_ID_FALLBACK;
  await setupEigenbelegeSourceSheet(eigenbelegeFolderId);
  await setupEigenbelegTemplate();
  console.log(JSON.stringify({
    status: 'ok',
    eigenbelegeFolderId,
    sheets: ['Eigenbelege', 'Eigenbeleg']
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

