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
function shouldLogAuthFailure({ reason = '', ip = '', agentId = '', endpoint = '', userAgent = '' }) {
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
    if (authResult?.kind === 'api-key') {
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      return next();
    }
    if (authResult?.kind === 'bot-client') {
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      req.apiClient = authResult.apiClient || null;
      return next();
    }
    if (authResult?.kind === 'installation-session') {
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      req.installation = authResult.installation || null;
      return next();
    }
    if (authResult?.kind === 'supabase-user') {
      req.user = authResult.user;
      req.agentId = authResult.agentId;
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
