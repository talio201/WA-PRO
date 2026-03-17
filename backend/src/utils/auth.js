const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  getClientByApiKey,
  touchClient,
  validateInstallationCredentials,
  getInstallationByActivationCode,
  touchInstallation,
  getAppConfig,
  getSaasUserByEmail,
  touchSaasUserLogin,
  isAdminEmail,
  upsertSaasUser,
} = require('../config/adminStore');

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function getSessionSigningSecret() {
  return String(process.env.API_SECRET_KEY || '').trim() || 'emidia-session-secret';
}

function signPayload(payload) {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = crypto
    .createHmac('sha256', getSessionSigningSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function verifyPayload(token) {
  const [header, body, signature] = String(token || '').trim().split('.');
  if (!header || !body || !signature) return null;
  const data = `${header}.${body}`;
  const expected = crypto
    .createHmac('sha256', getSessionSigningSecret())
    .update(data)
    .digest('base64url');
  if (signature !== expected) return null;
  try {
    return JSON.parse(fromBase64Url(body));
  } catch (error) {
    return null;
  }
}

function getSupabaseClient() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  return createClient(
    supabaseUrl,
    supabaseAnonKey,
  );
}

function getValidApiKey() {
  return String(process.env.API_SECRET_KEY || '').trim();
}

function isTruthy(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'admin';
}

function userHasAdminFlag(user = {}) {
  return (
    isTruthy(user?.user_metadata?.isAdmin)
    || isTruthy(user?.user_metadata?.is_admin)
    || isTruthy(user?.app_metadata?.isAdmin)
    || isTruthy(user?.app_metadata?.is_admin)
    || String(user?.app_metadata?.role || '').trim().toLowerCase() === 'admin'
    || String(user?.user_metadata?.role || '').trim().toLowerCase() === 'admin'
  );
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

  const sessionPayload = verifyPayload(safeToken);
  if (sessionPayload?.type === 'installation_session') {
    const now = Math.floor(Date.now() / 1000);
    if (Number(sessionPayload.exp || 0) <= now) {
      return null;
    }
    const installation = validateInstallationCredentials(
      sessionPayload.activationCode,
      sessionPayload.installationSecret,
    );
    if (!installation) {
      return null;
    }
    touchInstallation(sessionPayload.activationCode, {
      lastSessionAt: new Date().toISOString(),
      agentId: sessionPayload.agentId,
    });
    return {
      kind: 'installation-session',
      agentId: String(sessionPayload.agentId || installation.clientId || agentId || 'client').trim(),
      installation: {
        activationCode: installation.activationCode,
        clientId: installation.clientId,
      },
      permissions: {
        allowGemini: installation.permissions?.allowGemini !== false,
        allowRealtime: installation.permissions?.allowRealtime !== false,
        allowCampaigns: installation.permissions?.allowCampaigns !== false,
        allowContacts: installation.permissions?.allowContacts !== false,
        allowInbox: installation.permissions?.allowInbox !== false,
      },
    };
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: { user } = {}, error } = await supabase.auth.getUser(safeToken);
      if (!error && user) {
        const email = String(user.email || '').trim().toLowerCase();
        const adminBypass = userHasAdminFlag(user) || (email && isAdminEmail(email));
        let saasUser = null;
        if (!adminBypass) {
          saasUser = getSaasUserByEmail(email);
          if (!saasUser) {
            const defaultAgentId = String(
              user?.user_metadata?.agentId
              || user?.app_metadata?.agentId
              || `user_${String(user.id || '').slice(0, 12)}`,
            ).trim();
            saasUser = upsertSaasUser({
              email,
              agentId: defaultAgentId,
              status: 'pending',
              metadata: {
                source: 'supabase-signin',
                createdBy: 'auto-registration',
              },
            });
          }
          const nowMs = Date.now();
          if (saasUser.expiresAt && new Date(saasUser.expiresAt).getTime() <= nowMs) {
            saasUser = upsertSaasUser({
              email,
              status: 'suspended',
              metadata: {
                autoSuspendedAt: new Date().toISOString(),
                reason: 'license_expired',
              },
            });
          }
          touchSaasUserLogin(email, {
            lastAuthAt: new Date().toISOString(),
            source: 'supabase-auth',
          });
        }

        const resolvedAgentId = adminBypass
          ? 'admin'
          : String(
              saasUser?.agentId
                || saasUser?.clientId
                || user?.user_metadata?.agentId
                || `user_${String(user.id || '').slice(0, 12)}`,
            ).trim();
        const activeAccess = adminBypass || saasUser?.status === 'active';
        const isDemo = String(saasUser?.planTerm || '').trim().toLowerCase() === 'demo';

        return {
          kind: 'supabase-user',
          user,
          agentId: resolvedAgentId || 'admin',
          saasUser,
          permissions: {
            allowGemini: activeAccess && !isDemo,
            allowRealtime: activeAccess,
            allowCampaigns: activeAccess && !isDemo,
            allowContacts: activeAccess,
            allowInbox: activeAccess,
          },
        };
      }
    } catch (error) {
      return null;
    }
  }

  return null;
}

function issueInstallationSessionToken(installation, { ttlSeconds = 3600 * 12 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, Number(ttlSeconds) || 3600);
  const agentId = String(installation?.clientId || installation?.installationId || 'client').trim();
  const token = signPayload({
    type: 'installation_session',
    activationCode: installation.activationCode,
    installationSecret: installation.installationSecret,
    agentId,
    exp,
  });
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    agentId,
    config: getAppConfig(),
    permissions: {
      allowGemini: installation.permissions?.allowGemini !== false,
      allowRealtime: installation.permissions?.allowRealtime !== false,
      allowCampaigns: installation.permissions?.allowCampaigns !== false,
      allowContacts: installation.permissions?.allowContacts !== false,
      allowInbox: installation.permissions?.allowInbox !== false,
    },
  };
}

function getInstallationPublicStatus(activationCode) {
  const installation = getInstallationByActivationCode(activationCode);
  if (!installation) return null;
  return {
    activationCode: installation.activationCode,
    status: installation.status,
    planTerm: installation.planTerm || null,
    expiresAt: installation.expiresAt || null,
    activatedAt: installation.activatedAt || null,
    permissions: installation.permissions || {},
  };
}

module.exports = {
  authenticateBearerToken,
  getValidApiKey,
  issueInstallationSessionToken,
  getInstallationPublicStatus,
};
