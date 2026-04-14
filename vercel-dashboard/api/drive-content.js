const { requireAuth } = require('./_auth');
const { getDriveFileMetadata, getDriveFileContentStream } = require('./_google');
const { json, getRequestId, auditLog, setApiSecurityHeaders } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'drive-content', limit: 40, windowMs: 60_000 });
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

    const [meta, content] = await Promise.all([
      getDriveFileMetadata(fileId),
      getDriveFileContentStream(fileId)
    ]);

    if (meta.capabilities && meta.capabilities.canDownload === false) {
      json(res, 403, { ok: false, requestId, error: 'Download not permitted for this file' });
      auditLog(req, 403, requestId, startedAt);
      return;
    }

    const contentType = content.headers['content-type'] || meta.mimeType || 'application/octet-stream';
    const fileName = (meta.name || 'download').replace(/"/g, '');

    setApiSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    content.data.on('end', () => {
      auditLog(req, 200, requestId, startedAt);
    });

    content.data.on('error', () => {
      auditLog(req, 500, requestId, startedAt);
    });

    content.data.pipe(res);
  } catch (error) {
    json(res, 500, {
      ok: false,
      requestId,
      error: error && error.message ? error.message : String(error)
    });
    auditLog(req, 500, requestId, startedAt);
  }
};
