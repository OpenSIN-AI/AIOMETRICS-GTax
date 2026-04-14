const { requireAuth } = require('./_auth');
const { getSpreadsheetMeta, getSheetValues } = require('./_google');
const { json, errorPayload, getRequestId, auditLog } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSheetTitle(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/'/g, "''");
}

function toColumnLabel(idxOneBased) {
  let value = idxOneBased;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function rowsToGrid(values, limitRows) {
  if (!values.length) {
    return {
      headers: [],
      rows: []
    };
  }

  const maxCols = values.reduce((acc, row) => Math.max(acc, row.length), 0);
  const headers = Array.from({ length: maxCols }).map((_, idx) => `C${idx + 1}`);
  const body = values.slice(0, limitRows).map((row) => {
    const out = [];
    for (let i = 0; i < maxCols; i += 1) {
      out.push(row[i] || '');
    }
    return out;
  });

  return {
    headers,
    rows: body
  };
}

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'sheet', limit: 80, windowMs: 60_000 });
    if (!rate.allowed) {
      json(res, 429, { ok: false, requestId, error: 'Rate limit exceeded' });
      auditLog(req, 429, requestId, startedAt);
      return;
    }

    if (!requireAuth(req, res)) {
      auditLog(req, 401, requestId, startedAt);
      return;
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    if (!spreadsheetId) {
      json(res, 400, { ok: false, requestId, error: 'Missing GOOGLE_SHEET_ID' });
      auditLog(req, 400, requestId, startedAt);
      return;
    }

    const limitRows = clampInt(req.query.limitRows, 10, 2000, 300);
    const limitCols = clampInt(req.query.limitCols, 3, 120, 26);

    const meta = await getSpreadsheetMeta(spreadsheetId);
    const fallbackSheet = meta.sheets[0] ? meta.sheets[0].title : '';
    const requestedSheet = normalizeSheetTitle(req.query.sheet || fallbackSheet);

    const maxRow = limitRows + 1;
    const colLabel = toColumnLabel(limitCols);
    const range = req.query.range && typeof req.query.range === 'string'
      ? req.query.range
      : `'${requestedSheet}'!A1:${colLabel}${maxRow}`;

    const values = requestedSheet ? await getSheetValues({ spreadsheetId, range }) : [];
    const grid = rowsToGrid(values, limitRows);

    json(res, 200, {
      ok: true,
      requestId,
      spreadsheet: {
        id: spreadsheetId,
        title: meta.title,
        sheets: meta.sheets
      },
      selectedSheet: requestedSheet,
      range,
      rowCount: values.length,
      grid
    });
    auditLog(req, 200, requestId, startedAt);
  } catch (error) {
    json(res, 500, errorPayload(error, requestId));
    auditLog(req, 500, requestId, startedAt);
  }
};
