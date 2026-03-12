const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

  // 1. Check for Master API Key (Extension/Bot)
  const validKey = String(process.env.API_SECRET_KEY || '').trim();
  
  if (type === 'bearer' && token === validKey) {
    req.agentId = agentId || 'bot';
    return next();
  }

  // 2. Check for Supabase Session Token (Dashboard)
  if (type === 'bearer') {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (!error && user) {
      req.user = user;
      req.agentId = 'admin'; // Admin session from dashboard
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
