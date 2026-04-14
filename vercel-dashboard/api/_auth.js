const crypto = require('crypto');

function getBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return '';
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return '';
  }

  return parts[1].trim();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  const expectedToken = process.env.DASHBOARD_API_TOKEN || '';
  if (!expectedToken) {
    return true;
  }

  const bearerToken = getBearerToken(req);
  return bearerToken ? safeEqual(bearerToken, expectedToken) : false;
}

function rejectUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none';");
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
}

function requireAuth(req, res) {
  if (isAuthorized(req)) {
    return true;
  }
  rejectUnauthorized(res);
  return false;
}

module.exports = {
  requireAuth
};
