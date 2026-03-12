const { createClient } = require('@supabase/supabase-js');
const { getClientByApiKey, touchClient } = require('../config/adminStore');

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
      permissions: {
        allowGemini: true,
        allowRealtime: true,
        allowCampaigns: true,
        allowContacts: true,
        allowInbox: true,
      },
    };
  }

  const client = getClientByApiKey(safeToken);
  if (client) {
    touchClient(client.clientId);
    return {
      kind: 'bot-client',
      agentId: client.clientId,
      apiClient: {
        clientId: client.clientId,
        name: client.name,
      },
      permissions: {
        allowGemini: client.permissions?.allowGemini !== false,
        allowRealtime: client.permissions?.allowRealtime !== false,
        allowCampaigns: client.permissions?.allowCampaigns !== false,
        allowContacts: client.permissions?.allowContacts !== false,
        allowInbox: client.permissions?.allowInbox !== false,
      },
    };
  }

  const supabase = getSupabaseClient();
  const { data: { user } = {}, error } = await supabase.auth.getUser(safeToken);
  if (!error && user) {
    return {
      kind: 'supabase-user',
      user,
      agentId: 'admin',
      permissions: {
        allowGemini: true,
        allowRealtime: true,
        allowCampaigns: true,
        allowContacts: true,
        allowInbox: true,
      },
    };
  }

  return null;
}

module.exports = {
  authenticateBearerToken,
  getValidApiKey,
};
