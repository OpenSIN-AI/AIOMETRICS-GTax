function setApiSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none';");
}

function getRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function json(res, statusCode, payload) {
  setApiSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function errorPayload(error, requestId) {
  const message = error && error.message ? error.message : String(error);
  return {
    ok: false,
    requestId,
    error: message
  };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return 'unknown';
}

function auditLog(req, statusCode, requestId, startedAtMs) {
  const latencyMs = Date.now() - startedAtMs;
  const ip = getClientIp(req);
  const method = req.method || 'GET';
  const path = req.url || '';
  console.info(JSON.stringify({
    event: 'api_request',
    requestId,
    method,
    path,
    ip,
    statusCode,
    latencyMs
  }));
}

module.exports = {
  json,
  errorPayload,
  getRequestId,
  auditLog,
  setApiSecurityHeaders
};
