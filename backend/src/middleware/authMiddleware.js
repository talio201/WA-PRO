const { authenticateBearerToken } = require('../utils/auth');

// Import admin logging functions
let logSecurityEvent;
try {
  const adminController = require('../controllers/adminController');
  logSecurityEvent = adminController.logSecurityEvent;
} catch (e) {
  logSecurityEvent = () => {}; // Fallback if not available
}
const authFailureThrottle = new Map();

function isInternalBotAuthNoise({ reason = '', ip = '', agentId = '', endpoint = '' }) {
  const safeReason = String(reason || '').trim().toLowerCase();
  const safeAgent = String(agentId || '').trim().toLowerCase();
  const safeIp = String(ip || '').trim().toLowerCase();
  const safeEndpoint = String(endpoint || '').trim().toLowerCase();
  const isInternalIp =
    safeIp.startsWith('::ffff:172.18.') ||
    safeIp.startsWith('172.18.') ||
    safeIp === '::1' ||
    safeIp === '127.0.0.1';
  const isBotAgent = safeAgent === 'bot';
  const isInternalPollingEndpoint =
    safeEndpoint.includes('/api/messages/next') ||
    safeEndpoint.includes('/api/bot/status') ||
    safeEndpoint.includes('/api/bot/live-activity') ||
    safeEndpoint.includes('/api/bot/commands/next');
  return (
    safeReason === 'invalid_token' &&
    isBotAgent &&
    isInternalIp &&
    isInternalPollingEndpoint
  );
}

function shouldLogAuthFailure({ reason = '', ip = '', agentId = '', endpoint = '', userAgent = '' }) {
  if (isInternalBotAuthNoise({ reason, ip, agentId, endpoint })) {
    return false;
  }
  const key = `${reason}|${ip}|${agentId}|${endpoint}|${userAgent}`;
  const now = Date.now();
  const lastAt = Number(authFailureThrottle.get(key) || 0);
  if (now - lastAt < 30000) {
    return false;
  }
  authFailureThrottle.set(key, now);
  if (authFailureThrottle.size > 5000) {
    const entries = Array.from(authFailureThrottle.entries()).slice(-2000);
    authFailureThrottle.clear();
    entries.forEach(([k, v]) => authFailureThrottle.set(k, v));
  }
  return true;
}

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const agentId = req.headers['x-agent-id'];
  
  if (!authHeader) {
    if (shouldLogAuthFailure({ reason: 'missing_header', ip, userAgent, endpoint: req.originalUrl, agentId })) {
      logSecurityEvent('auth_failed', {
        reason: 'missing_header',
        ip,
        userAgent,
        endpoint: req.originalUrl,
      });
    }
    return res
      .status(401)
      .json({ msg: "Unauthorized: Missing Authorization header" });
  }

  const parts = authHeader.split(' ');
  const token = String(parts[1] || '').trim();
  const type = String(parts[0] || '').toLowerCase();

  if (type === 'bearer') {
    const authResult = await authenticateBearerToken(token, agentId);
    if (!authResult) {
      console.log('[AUTH MIDDLEWARE] authenticateBearerToken returned null', { agentId });
    }
    if (authResult?.kind === 'api-key') {
      req.authKind = authResult.kind;
      // Force requirement of x-agent-id header when using master API key to prevent 'bot' collision
      if (!agentId || agentId === 'bot') {
        return res.status(400).json({ 
          msg: "Missing or invalid x-agent-id header. For multi-tenant isolation, provide a unique agentId.",
          code: "AGENT_ID_REQUIRED"
        });
      }
      req.agentId = agentId;
      req.permissions = authResult.permissions || {};
      return next();
    }
    if (authResult?.kind === 'bot-client') {
      req.authKind = authResult.kind;
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      req.apiClient = authResult.apiClient || null;
      return next();
    }
    if (authResult?.kind === 'installation-session') {
      req.authKind = authResult.kind;
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      req.installation = authResult.installation || null;
      return next();
    }
    if (authResult?.kind === 'supabase-user') {
      req.authKind = authResult.kind;
      req.user = authResult.user;
      req.agentId = authResult.agentId;
      req.isAdmin = authResult.isAdmin || false;
      req.permissions = authResult.permissions || {};
      req.saasUser = authResult.saasUser || null;
      return next();
    }
    if (authResult?.kind === 'local-dev-session') {
      req.authKind = authResult.kind;
      req.user = authResult.user;
      req.agentId = authResult.agentId;
      req.isAdmin = authResult.isAdmin || false;
      req.permissions = authResult.permissions || {};
      req.saasUser = authResult.saasUser || null;
      return next();
    }
  }

  // Log failed auth attempt
  if (shouldLogAuthFailure({ reason: 'invalid_token', ip, userAgent, endpoint: req.originalUrl, agentId })) {
    logSecurityEvent('auth_failed', {
      reason: 'invalid_token',
      ip,
      userAgent,
      agentId,
      endpoint: req.originalUrl,
    });
  }

  return res.status(401).json({ msg: "Unauthorized: Invalid token or key." });
};

module.exports = requireAuth;
