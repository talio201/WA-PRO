const { authenticateBearerToken } = require('../utils/auth');

// Import admin logging functions
let logSecurityEvent;
try {
  const adminController = require('../controllers/adminController');
  logSecurityEvent = adminController.logSecurityEvent;
} catch (e) {
  logSecurityEvent = () => {}; // Fallback if not available
}

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const agentId = req.headers['x-agent-id'];
  
  if (!authHeader) {
    logSecurityEvent('auth_failed', {
      reason: 'missing_header',
      ip,
      userAgent,
      endpoint: req.originalUrl,
    });
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
    if (authResult?.kind === 'supabase-user') {
      req.user = authResult.user;
      req.agentId = authResult.agentId;
      req.permissions = authResult.permissions || {};
      return next();
    }
  }

  // Log failed auth attempt
  logSecurityEvent('auth_failed', {
    reason: 'invalid_token',
    ip,
    userAgent,
    agentId,
    endpoint: req.originalUrl,
  });

  return res.status(401).json({ msg: "Unauthorized: Invalid token or key." });
};

module.exports = requireAuth;
