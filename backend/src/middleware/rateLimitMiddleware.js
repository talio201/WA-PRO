const windowBuckets = new Map();

function cleanupBuckets() {
  if (windowBuckets.size <= 10000) return;
  const now = Date.now();
  for (const [key, bucket] of windowBuckets.entries()) {
    if (!bucket || now > bucket.resetAt) {
      windowBuckets.delete(key);
    }
  }
}

function getClientIp(req) {
  return String(
    req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']
      || req.ip
      || req.connection?.remoteAddress
      || 'unknown',
  ).split(',')[0].trim();
}

function createRateLimiter({
  keyPrefix,
  maxRequests,
  windowMs,
  keyFn,
  errorMessage,
}) {
  const safePrefix = String(keyPrefix || 'global').trim() || 'global';
  const safeMax = Math.max(1, Number(maxRequests) || 1);
  const safeWindow = Math.max(1000, Number(windowMs) || 60000);

  return function rateLimiter(req, res, next) {
    try {
      cleanupBuckets();
      const keyPart = String((keyFn ? keyFn(req) : getClientIp(req)) || 'unknown').trim();
      const bucketKey = `${safePrefix}:${keyPart}`;
      const now = Date.now();
      const existing = windowBuckets.get(bucketKey);

      if (!existing || now > existing.resetAt) {
        const resetAt = now + safeWindow;
        windowBuckets.set(bucketKey, {
          count: 1,
          resetAt,
        });
        res.setHeader('X-RateLimit-Limit', String(safeMax));
        res.setHeader('X-RateLimit-Remaining', String(safeMax - 1));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
        return next();
      }

      existing.count += 1;
      const remaining = Math.max(safeMax - existing.count, 0);
      res.setHeader('X-RateLimit-Limit', String(safeMax));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));

      if (existing.count > safeMax) {
        res.setHeader('Retry-After', String(Math.ceil((existing.resetAt - now) / 1000)));
        return res.status(429).json({
          msg: errorMessage || 'Too many requests. Please try again later.',
        });
      }

      return next();
    } catch (error) {
      return next();
    }
  };
}

module.exports = {
  createRateLimiter,
  getClientIp,
};
