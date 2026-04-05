const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { secureLog, hashToken, hashEmail, logAuthAttempt } = require('./secureLogs');
const {
  getClientByApiKey,
  touchClient,
  validateInstallationCredentials,
  getInstallationByActivationCode,
  touchInstallation,
  getAppConfig,
  isAdminEmail,
  getSaasUserByEmail,
  touchSaasUserLogin,
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

function shouldRequireStrictApproval() {
  const raw = String(process.env.SAAS_REQUIRE_APPROVAL_STRICT || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
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

function buildLegacySaasUserFallback({ email = '', agentId = '', user = {} }) {
  const strictApproval = shouldRequireStrictApproval();
  const hasLegacyAdminTrust = Boolean(
    (email && isAdminEmail(email))
    || userHasAdminFlag(user),
  );
  const shouldAllowLegacyAccess = !strictApproval || hasLegacyAdminTrust;

  return {
    email: String(email || '').trim().toLowerCase() || null,
    agentId: String(agentId || '').trim() || null,
    status: shouldAllowLegacyAccess ? 'active' : 'pending',
    clientId: null,
    activationCode: null,
    planTerm: shouldAllowLegacyAccess ? 'lifetime' : null,
    expiresAt: null,
    activatedAt: null,
    createdAt: null,
    updatedAt: null,
    lastLoginAt: new Date().toISOString(),
    metadata: {
      source: 'legacy-auth-fallback',
      strictApproval,
      fallbackAccess: shouldAllowLegacyAccess ? 'legacy_active' : 'legacy_pending',
      access: {
        allowApp: shouldAllowLegacyAccess,
        allowAdmin: hasLegacyAdminTrust,
        allowBot: true,
      },
    },
  };
}

async function authenticateBearerToken(token, agentId = '') {
  const safeToken = String(token || '').trim();
  secureLog('log', '[authenticateBearerToken] Starting authentication', { tokenHash: hashToken(token) });
  
  if (!safeToken) {
    secureLog('log', '[authenticateBearerToken] No token provided');
    return null;
  }

  const validKey = getValidApiKey();
  if (validKey && safeToken === validKey) {
    secureLog('info', '[authenticateBearerToken] Authenticated as API_SECRET_KEY');
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
    secureLog('info', '[authenticateBearerToken] Authenticated as bot-client', {
      clientId: client.clientId,
      tokenHash: hashToken(token),
    });
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
    console.log('[DEBUG authenticateBearerToken] Verifying installation session...');
    const now = Math.floor(Date.now() / 1000);
    if (Number(sessionPayload.exp || 0) <= now) {
      console.log('[DEBUG authenticateBearerToken] Installation session EXPIRED');
      return null;
    }
    const installation = validateInstallationCredentials(
      sessionPayload.activationCode,
      sessionPayload.installationSecret,
    );
    if (!installation) {
      console.log('[DEBUG authenticateBearerToken] Installation session INVALID');
      return null;
    }
    console.log('[DEBUG authenticateBearerToken] Authenticated as installation-session:', installation.clientId);
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
    console.log('[DEBUG authenticateBearerToken] Attempting Supabase user authentication...');
    try {
      const { data: { user } = {}, error } = await supabase.auth.getUser(safeToken);
      if (error) {
        console.log('[DEBUG authenticateBearerToken] Supabase error:', error.message);
        return null;
      }
      if (!user) {
        console.log('[DEBUG authenticateBearerToken] No user returned from Supabase');
        return null;
      }
      
      const email = String(user?.email || '').trim().toLowerCase();
      console.log('[DEBUG authenticateBearerToken] Supabase user found:', { email, userId: user?.id });
      
      const touchedUser = email
        ? touchSaasUserLogin(email, {
            userId: String(user?.id || '').trim() || null,
            source: 'supabase-login',
            supabaseUserId: String(user?.id || '').trim() || null,
          })
        : null;
      
      console.log('[DEBUG authenticateBearerToken] SaaS user touched:', touchedUser ? 'YES' : 'NO');
      
      const mappedSaasUser = touchedUser || (email ? getSaasUserByEmail(email) : null);
      const saasUser = mappedSaasUser || buildLegacySaasUserFallback({
        email,
        agentId: String(user?.id || agentId || '').trim(),
        user,
      });
      const saasAccess = saasUser?.metadata?.access || {};
      const isAdmin = Boolean(
        (email && isAdminEmail(email))
        || userHasAdminFlag(user)
        || saasAccess?.allowAdmin === true
      );

      logAuthAttempt('supabase-user-auth', {
        emailHash: hashEmail(email),
        isAdmin,
        tokenHash: hashToken(token),
        agentId: String(user?.id || agentId || '').substring(0, 8),
      });

      const resolvedAgentId = String(
        saasUser?.clientId || saasUser?.agentId || user?.id || agentId || (isAdmin ? 'admin' : 'user'),
      ).trim() || (isAdmin ? 'admin' : 'user');
      
      secureLog('info', '[authenticateBearerToken] Authenticated as supabase-user', {
        emailHash: hashEmail(email),
        agentId: resolvedAgentId,
        isAdmin,
      });
      
      return {
        kind: 'supabase-user',
        user,
        agentId: resolvedAgentId,
        isAdmin,
        saasUser,
        permissions: {
          allowGemini: true,
          allowRealtime: true,
          allowCampaigns: true,
          allowContacts: true,
          allowInbox: true,
        },
      };
    } catch (error) {
      secureLog('error', '[authenticateBearerToken] Supabase exception', {
        message: error.message,
        tokenHash: hashToken(token),
      });
      return null;
    }
  }

  secureLog('debug', '[authenticateBearerToken] No Supabase client - returning null');
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
