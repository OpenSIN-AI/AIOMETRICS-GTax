const { requireAuth } = require('./_auth');
const { batchGetSheetValues } = require('./_google');
const { json, errorPayload, getRequestId, auditLog } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

function normalizeRanges(query) {
  if (Array.isArray(query.ranges)) {
    return query.ranges.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof query.ranges === 'string') {
    return query.ranges.split(',').map((item) => item.trim()).filter(Boolean);
  }

  if (typeof query.range === 'string' && query.range.trim()) {
    return [query.range.trim()];
  }

  return [];
}

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'sheet-batch', limit: 40, windowMs: 60_000 });
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

    const ranges = normalizeRanges(req.query);
    if (ranges.length === 0) {
      json(res, 400, {
        ok: false,
        requestId,
        error: 'Set at least one range via ?ranges=A1:B10,Sheet2!A1:C20'
      });
      auditLog(req, 400, requestId, startedAt);
      return;
    }

    const valueRanges = await batchGetSheetValues({ spreadsheetId, ranges });
    json(res, 200, {
      ok: true,
      requestId,
      spreadsheetId,
      ranges,
      valueRanges
    });
    auditLog(req, 200, requestId, startedAt);
  } catch (error) {
    json(res, 500, errorPayload(error, requestId));
    auditLog(req, 500, requestId, startedAt);
  }
};
