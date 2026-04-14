const { google } = require('googleapis');

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];

let cachedAuth = null;
let cachedFingerprint = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error) {
  const status = Number(error && (error.code || (error.response && error.response.status)));
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const reason = String(
    (error && error.errors && error.errors[0] && error.errors[0].reason) ||
    (error && error.response && error.response.data && error.response.data.error && error.response.data.error.message) ||
    (error && error.message) || ''
  ).toLowerCase();

  return reason.includes('rate limit') || reason.includes('quota') || reason.includes('backend error');
}

async function withRetry(operation, label) {
  const maxAttempts = 5;
  let delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!shouldRetry(error) || attempt === maxAttempts) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 300);
      const waitMs = Math.min(8_000, delayMs) + jitter;
      console.warn(`${label}: retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await sleep(waitMs);
      delayMs *= 2;
    }
  }

  throw new Error(`${label}: exhausted retries`);
}

function parseServiceAccountFromBase64(encoded) {
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  return JSON.parse(json);
}

function loadServiceAccount() {
  const jsonBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (jsonBase64) {
    const parsed = parseServiceAccountFromBase64(jsonBase64);
    return {
      client_email: parsed.client_email,
      private_key: String(parsed.private_key || '').replace(/\\n/g, '\n')
    };
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing service account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
  }

  return {
    client_email: clientEmail,
    private_key: privateKey
  };
}

function getAuth() {
  const credentials = loadServiceAccount();
  const fingerprint = `${credentials.client_email}|${credentials.private_key.length}`;

  if (!cachedAuth || cachedFingerprint !== fingerprint) {
    cachedAuth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: DEFAULT_SCOPES
    });
    cachedFingerprint = fingerprint;
  }

  return cachedAuth;
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

async function getSpreadsheetMeta(spreadsheetId) {
  const sheets = getSheetsClient();
  const response = await withRetry(
    () => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount))'
    }),
    'sheets.spreadsheets.get'
  );

  const title = response.data.properties && response.data.properties.title ? response.data.properties.title : '';
  const sheetsMeta = (response.data.sheets || []).map((sheet) => ({
    sheetId: sheet.properties && sheet.properties.sheetId,
    title: sheet.properties && sheet.properties.title ? sheet.properties.title : '',
    index: sheet.properties && typeof sheet.properties.index === 'number' ? sheet.properties.index : 0,
    grid: sheet.properties && sheet.properties.gridProperties ? sheet.properties.gridProperties : {}
  }));

  sheetsMeta.sort((a, b) => a.index - b.index);

  return {
    title,
    sheets: sheetsMeta
  };
}

async function getSheetValues({ spreadsheetId, range }) {
  const sheets = getSheetsClient();
  const response = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range }),
    'sheets.values.get'
  );

  return response.data.values || [];
}

async function batchGetSheetValues({ spreadsheetId, ranges }) {
  const sheets = getSheetsClient();
  const response = await withRetry(
    () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
    'sheets.values.batchGet'
  );

  return response.data.valueRanges || [];
}

function escapeNameContains(value) {
  return String(value || '').replace(/'/g, "\\'");
}

async function listDriveFiles({ folderId, pageSize, pageToken, search }) {
  const drive = getDriveClient();
  const clauses = [`'${folderId}' in parents`, 'trashed = false'];

  if (search) {
    clauses.push(`name contains '${escapeNameContains(search)}'`);
  }

  const response = await withRetry(
    () => drive.files.list({
      q: clauses.join(' and '),
      orderBy: 'folder,name_natural,modifiedTime desc',
      fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,webViewLink,parents,owners(displayName,emailAddress),iconLink,capabilities(canDownload,canEdit,canShare))',
      pageSize,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    }),
    'drive.files.list'
  );

  return {
    files: response.data.files || [],
    nextPageToken: response.data.nextPageToken || ''
  };
}

async function getDriveFileMetadata(fileId) {
  const drive = getDriveClient();
  const response = await withRetry(
    () => drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink,parents,owners(displayName,emailAddress),iconLink,capabilities(canDownload,canEdit,canShare)',
      supportsAllDrives: true
    }),
    'drive.files.get.metadata'
  );

  return response.data;
}

async function getDriveFileContentStream(fileId) {
  const drive = getDriveClient();
  return withRetry(
    () => drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true
      },
      {
        responseType: 'stream'
      }
    ),
    'drive.files.get.media'
  );
}

async function exportDriveFileStream(fileId, mimeType) {
  const drive = getDriveClient();
  return withRetry(
    () => drive.files.export(
      {
        fileId,
        mimeType
      },
      {
        responseType: 'stream'
      }
    ),
    'drive.files.export'
  );
}

module.exports = {
  getSpreadsheetMeta,
  getSheetValues,
  batchGetSheetValues,
  listDriveFiles,
  getDriveFileMetadata,
  getDriveFileContentStream,
  exportDriveFileStream
};
