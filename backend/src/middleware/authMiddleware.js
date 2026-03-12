const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
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
    req.agentId = req.headers['x-agent-id'] || 'bot';
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

  return res.status(401).json({ msg: "Unauthorized: Invalid token or key." });
};

module.exports = requireAuth;
