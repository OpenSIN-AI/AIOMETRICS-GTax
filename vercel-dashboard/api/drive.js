const { requireAuth } = require('./_auth');
const { listDriveFiles, getDriveFileMetadata } = require('./_google');
const { json, errorPayload, getRequestId, auditLog } = require('./_response');
const { enforceRateLimit } = require('./_rate_limit');

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

module.exports = async function handler(req, res) {
  const requestId = getRequestId();
  const startedAt = Date.now();

  try {
    const rate = enforceRateLimit(req, res, { prefix: 'drive', limit: 120, windowMs: 60_000 });
    if (!rate.allowed) {
      json(res, 429, { ok: false, requestId, error: 'Rate limit exceeded' });
      auditLog(req, 429, requestId, startedAt);
      return;
    }

    if (!requireAuth(req, res)) {
      auditLog(req, 401, requestId, startedAt);
      return;
    }

    const folderId = (typeof req.query.folderId === 'string' && req.query.folderId.trim())
      ? req.query.folderId.trim()
      : (process.env.GOOGLE_DRIVE_FOLDER_ID || '');

    if (!folderId) {
      json(res, 400, {
        ok: false,
        requestId,
        error: 'Missing GOOGLE_DRIVE_FOLDER_ID or folderId query parameter'
      });
      auditLog(req, 400, requestId, startedAt);
      return;
    }

    const limit = clampInt(req.query.limit, 1, 200, 100);
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : '';

    const [list, folder] = await Promise.all([
      listDriveFiles({ folderId, pageSize: limit, pageToken, search }),
      getDriveFileMetadata(folderId)
    ]);

    const files = list.files.map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      isFolder: (file.mimeType || '') === 'application/vnd.google-apps.folder',
      size: file.size ? Number(file.size) : null,
      modifiedTime: file.modifiedTime || '',
      webViewLink: file.webViewLink || '',
      owner: file.owners && file.owners[0] ? (file.owners[0].emailAddress || file.owners[0].displayName || '') : '',
      iconLink: file.iconLink || '',
      capabilities: file.capabilities || {}
    }));

    files.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
    });

    json(res, 200, {
      ok: true,
      requestId,
      folder: {
        id: folder.id || folderId,
        name: folder.name || 'Folder',
        parentId: folder.parents && folder.parents[0] ? folder.parents[0] : null,
        capabilities: folder.capabilities || {}
      },
      count: files.length,
      nextPageToken: list.nextPageToken || '',
      files
    });
    auditLog(req, 200, requestId, startedAt);
  } catch (error) {
    json(res, 500, errorPayload(error, requestId));
    auditLog(req, 500, requestId, startedAt);
  }
};
