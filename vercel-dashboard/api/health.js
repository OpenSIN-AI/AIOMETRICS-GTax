const { requireAuth } = require('./_auth');
const { getSheetValues, listDriveFiles } = require('./_google');
const { json, errorPayload, getRequestId, auditLog } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'health', limit: 120, windowMs: 60_000 });
    if (!rate.allowed) {
      json(res, 429, { ok: false, requestId, error: 'Rate limit exceeded' });
      auditLog(req, 429, requestId, startedAt);
      return;
    }

    if (!requireAuth(req, res)) {
      auditLog(req, 401, requestId, startedAt);
      return;
    }

    const sheetId = process.env.GOOGLE_SHEET_ID || '';
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
    const range = process.env.GOOGLE_SHEET_RANGE || 'belege!A1:Z200';

    const checks = {
      hasServiceAccount: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      hasSheetId: Boolean(sheetId),
      hasDriveFolderId: Boolean(driveFolderId)
    };

    const probe = {
      sheets: { ok: false, detail: 'skipped' },
      drive: { ok: false, detail: 'skipped' }
    };

    if (checks.hasSheetId) {
      await getSheetValues({ spreadsheetId: sheetId, range: 'A1:A1' });
      probe.sheets = { ok: true, detail: `connected (${range})` };
    }

    if (checks.hasDriveFolderId) {
      const data = await listDriveFiles({ folderId: driveFolderId, pageSize: 1 });
      probe.drive = { ok: true, detail: `connected (${data.files.length} sample files)` };
    }

    json(res, 200, {
      ok: true,
      requestId,
      timestamp: new Date().toISOString(),
      checks,
      probe
    });
    auditLog(req, 200, requestId, startedAt);
  } catch (error) {
    json(res, 500, errorPayload(error, requestId));
    auditLog(req, 500, requestId, startedAt);
  }
};
