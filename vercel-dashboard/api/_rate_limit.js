const BUCKETS = new Map();

function getClientKey(req, prefix) {
  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').toString().split(',')[0].trim();
  return `${prefix}:${ip}`;
}

function enforceRateLimit(req, res, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 120;
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 60_000;
  const key = getClientKey(req, options.prefix || 'global');

  const now = Date.now();
  const current = BUCKETS.get(key);

  if (!current || now >= current.resetAt) {
    BUCKETS.set(key, {
      count: 1,
      resetAt: now + windowMs
    });

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(limit - 1));
    res.setHeader('RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
    return { allowed: true };
  }

  current.count += 1;
  BUCKETS.set(key, current);

  const remaining = Math.max(0, limit - current.count);
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

  if (current.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
    return { allowed: false };
  }

  return { allowed: true };
}

module.exports = {
  enforceRateLimit
};
