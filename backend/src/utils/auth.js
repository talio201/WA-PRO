const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  return createClient(
    String(process.env.SUPABASE_URL || '').trim(),
    String(process.env.SUPABASE_ANON_KEY || '').trim(),
  );
}

function getValidApiKey() {
  return String(process.env.API_SECRET_KEY || '').trim();
}

async function authenticateBearerToken(token, agentId = '') {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;

  const validKey = getValidApiKey();
  if (validKey && safeToken === validKey) {
    return {
      kind: 'api-key',
      agentId: String(agentId || 'bot').trim() || 'bot',
    };
  }

  const supabase = getSupabaseClient();
  const { data: { user } = {}, error } = await supabase.auth.getUser(safeToken);
  if (!error && user) {
    return {
      kind: 'supabase-user',
      user,
      agentId: 'admin',
    };
  }

  return null;
}

module.exports = {
  authenticateBearerToken,
  getValidApiKey,
};
