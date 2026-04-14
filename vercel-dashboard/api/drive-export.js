const { requireAuth } = require('./_auth');
const { getDriveFileMetadata, exportDriveFileStream } = require('./_google');
const { json, getRequestId, auditLog, setApiSecurityHeaders } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

const DEFAULT_EXPORT_MIME = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'image/png'
};

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'drive-export', limit: 30, windowMs: 60_000 });
    if (!rate.allowed) {
      json(res, 429, { ok: false, requestId, error: 'Rate limit exceeded' });
      auditLog(req, 429, requestId, startedAt);
      return;
    }

    if (!requireAuth(req, res)) {
      auditLog(req, 401, requestId, startedAt);
      return;
    }

    const fileId = typeof req.query.fileId === 'string' ? req.query.fileId.trim() : '';
    if (!fileId) {
      json(res, 400, { ok: false, requestId, error: 'Missing fileId query parameter' });
      auditLog(req, 400, requestId, startedAt);
      return;
    }

    const meta = await getDriveFileMetadata(fileId);
    const sourceType = meta.mimeType || '';

    if (!sourceType.startsWith('application/vnd.google-apps.')) {
      json(res, 400, { ok: false, requestId, error: 'files.export only supports Google-native docs' });
      auditLog(req, 400, requestId, startedAt);
      return;
    }

    const targetMime = (typeof req.query.mimeType === 'string' && req.query.mimeType.trim())
      ? req.query.mimeType.trim()
      : (DEFAULT_EXPORT_MIME[sourceType] || 'application/pdf');

    const exported = await exportDriveFileStream(fileId, targetMime);

    const safeName = (meta.name || 'export').replace(/"/g, '');
    const extension = targetMime === 'application/pdf'
      ? 'pdf'
      : targetMime === 'text/csv'
        ? 'csv'
        : targetMime === 'image/png'
          ? 'png'
          : 'bin';

    setApiSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', targetMime);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}.${extension}"`);

    exported.data.on('end', () => {
      auditLog(req, 200, requestId, startedAt);
    });

    exported.data.on('error', () => {
      auditLog(req, 500, requestId, startedAt);
    });

    exported.data.pipe(res);
  } catch (error) {
    json(res, 500, {
      ok: false,
      requestId,
      error: error && error.message ? error.message : String(error)
    });
    auditLog(req, 500, requestId, startedAt);
  }
};
