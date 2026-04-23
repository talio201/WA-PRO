const {
  registerInstallation,
  getInstallationByActivationCode,
  validateInstallationCredentials,
  touchInstallation,
  getAppConfig,
  upsertSaasUser,
  addAdminUser,
  canStartDemoForIp,
  listAdminUsers,
} = require('../config/adminStore');
const { emitRealtimeEvent } = require('../realtime/realtime');
const crypto = require('crypto');
const {
  issueInstallationSessionToken,
  getInstallationPublicStatus,
  isLocalDevAuthEnabled,
  getLocalDevAuthAllowedEmails,
  issueLocalDevSessionToken,
} = require('../utils/auth');

function safeString(value = '') {
  return String(value || '').trim();
}

function hashIdentifier(value = '') {
  const safe = safeString(value).toLowerCase();
  if (!safe) return '';
  return crypto.createHash('sha256').update(safe).digest('hex');
}

function getBootstrapSecret() {
  return safeString(process.env.ADMIN_BOOTSTRAP_SECRET);
}

function getBootstrapAllowlist() {
  return String(process.env.ADMIN_BOOTSTRAP_ALLOWLIST_HASHES || process.env.ADMIN_BOOTSTRAP_HASHES || '')
    .split(',')
    .map((item) => safeString(item).toLowerCase())
    .filter(Boolean);
}

function isAuthorizedBootstrapUser(user = {}) {
  const allowlist = getBootstrapAllowlist();
  if (!allowlist.length) {
    return true;
  }

  const candidates = [user?.email, user?.id]
    .map((item) => hashIdentifier(item))
    .filter(Boolean);

  return candidates.some((candidate) => allowlist.includes(candidate));
}

exports.registerInstallation = async (req, res) => {
  try {
    const payload = {
      activationCode: safeString(req.body?.activationCode).toUpperCase(),
      installationId: safeString(req.body?.installationId),
      installationSecret: safeString(req.body?.installationSecret),
      metadata: req.body?.metadata || {},
    };

    if (!payload.activationCode || !payload.installationId || !payload.installationSecret) {
      return res.status(400).json({ msg: 'activationCode, installationId and installationSecret are required.' });
    }

    const installation = registerInstallation(payload);
    return res.json({ success: true, installation });
  } catch (error) {
    return res.status(500).json({ msg: 'Failed to register installation.' });
  }
};

exports.getActivationStatus = async (req, res) => {
  try {
    const activationCode = safeString(req.params.activationCode).toUpperCase();
    if (!activationCode) {
      return res.status(400).json({ msg: 'activationCode is required.' });
    }
    const status = getInstallationPublicStatus(activationCode);
    if (!status) {
      return res.status(404).json({ msg: 'Activation code not found.' });
    }
    return res.json({ success: true, status });
  } catch (error) {
    return res.status(500).json({ msg: 'Failed to get activation status.' });
  }
};

exports.createSession = async (req, res) => {
  try {
    const activationCode = safeString(req.body?.activationCode).toUpperCase();
    const installationSecret = safeString(req.body?.installationSecret);
    if (!activationCode || !installationSecret) {
      return res.status(400).json({ msg: 'activationCode and installationSecret are required.' });
    }

    const installation = validateInstallationCredentials(activationCode, installationSecret);
    if (!installation) {
      return res.status(401).json({ msg: 'Installation not active or invalid credentials.' });
    }

    const session = issueInstallationSessionToken(installation, {
      ttlSeconds: Number(process.env.INSTALLATION_SESSION_TTL_SECONDS || 3600 * 12),
    });

    touchInstallation(activationCode, {
      lastSessionIssueAt: new Date().toISOString(),
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, session });
  } catch (error) {
    return res.status(500).json({ msg: 'Failed to create installation session.' });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    const activationCode = safeString(req.body?.activationCode).toUpperCase();
    if (!activationCode) {
      return res.status(400).json({ msg: 'activationCode is required.' });
    }

    const installation = getInstallationByActivationCode(activationCode);
    if (!installation) {
      return res.status(404).json({ msg: 'Installation not found.' });
    }

    const updated = touchInstallation(activationCode, {
      heartbeatAt: new Date().toISOString(),
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      ...((req.body && req.body.metadata) || {}),
    });

    return res.json({ success: true, installation: updated });
  } catch (error) {
    return res.status(500).json({ msg: 'Failed to update heartbeat.' });
  }
};

exports.getPublicRuntimeConfig = async (req, res) => {
  try {
    const appConfig = getAppConfig();
    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
    const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[runtime-config] SUPABASE_URL or SUPABASE_ANON_KEY missing:', { supabaseUrl, supabaseAnonKey });
      return res.status(500).json({ msg: 'SUPABASE_URL or SUPABASE_ANON_KEY missing in backend environment.' });
    }
    return res.json({
      success: true,
      config: {
        backendApiUrl: appConfig.backendApiUrl,
        backendWsUrl: appConfig.backendWsUrl,
        supabase: {
          url: supabaseUrl,
          anonKey: supabaseAnonKey,
        },
      },
    });
  } catch (error) {
    console.error('[runtime-config] Unexpected error:', error);
    return res.status(500).json({ msg: 'Failed to get runtime config.' });
  }
};

exports.requestSaasSignupApproval = async (req, res) => {
  try {
    const email = safeString(req.body?.email).toLowerCase();
    
    // Alinhamento rigoroso 1:1 - ID Gerado pelo Backend que não pode ser alterado pelo front/user
    const baseHash = crypto.randomBytes(4).toString('hex');
    const timeHash = Date.now().toString(36).slice(-4);
    const requestedAgentId = `bot_${baseHash}_${timeHash}`;

    const desiredPlan = safeString(req.body?.desiredPlan || 'demo').toLowerCase();
    const documentId = safeString(req.body?.documentId || req.body?.cpfCnpj || '').replace(/\D/g, '');
    const companyName = safeString(req.body?.companyName || req.body?.fullName || '');
    const seats = Math.max(1, Math.min(1000, Number(req.body?.seats || req.body?.usersCount || 1) || 1));
    const requestIp = req.ip || req.connection?.remoteAddress;
    if (!email) {
      return res.status(400).json({ msg: 'email is required.' });
    }
    if (documentId && documentId.length !== 11 && documentId.length !== 14) {
      return res.status(400).json({ msg: 'CPF/CNPJ inválido. Use 11 ou 14 dígitos.' });
    }
    if (desiredPlan === 'demo') {
      const demoEligibility = canStartDemoForIp(requestIp);
      if (!demoEligibility.allowed) {
        return res.status(403).json({
          msg: demoEligibility.msg || 'Período DEMO indisponível para este IP. Escolha plano pago.',
          code: demoEligibility.reason || 'demo_blocked',
        });
      }
    }

    const user = upsertSaasUser({
      email,
      agentId: requestedAgentId,
      status: 'pending',
      planTerm: desiredPlan,
      metadata: {
        requestSource: 'webapp-signup',
        requestedAt: new Date().toISOString(),
        requestIp,
        userAgent: req.headers['user-agent'],
        desiredPlan,
        cpfCnpj: documentId || null,
        companyName: companyName || null,
        seats,
      },
    });

    emitRealtimeEvent('admin.saas_signup_requested', {
      email: user.email,
      agentId: user.agentId,
      status: user.status,
      desiredPlan,
      companyName: companyName || null,
      seats,
      requestedAt: new Date().toISOString(),
    });

    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ msg: 'Failed to create signup approval request.' });
  }
};

exports.bootstrapAdminAccess = async (req, res) => {
  try {
    const genericDeniedMsg = 'Sua conta não tem acesso administrativo.';
    const bootstrapSecret = safeString(req.body?.bootstrapSecret || req.body?.secret);
    const configuredSecret = getBootstrapSecret();
    const configuredAdmins = listAdminUsers();
    const hasConfiguredAdmins = Array.isArray(configuredAdmins) && configuredAdmins.length > 0;

    console.log('\n[DEBUG bootstrapAdminAccess] ===== BOOTSTRAP ADMIN ACCESS =====', {
      bootstrapSecret: bootstrapSecret ? '***' : 'empty',
      configuredSecret: configuredSecret ? '***' : 'empty',
      configuredAdmins,
      hasConfiguredAdmins,
      userEmail: req.user?.email,
      userId: req.user?.id,
    });

    if (!configuredSecret) {
      if (hasConfiguredAdmins) {
        console.log('[DEBUG bootstrapAdminAccess] DENIED: No secret configured but admins exist');
        return res.status(403).json({ msg: genericDeniedMsg });
      }
      console.log('[DEBUG bootstrapAdminAccess] Allowing bootstrap: no secret configured + no admins exist');
    } else {
      if (!bootstrapSecret) {
        console.log('[DEBUG bootstrapAdminAccess] DENIED: Secret required but not provided');
        return res.status(403).json({ msg: genericDeniedMsg });
      }
      if (bootstrapSecret !== configuredSecret) {
        console.log('[DEBUG bootstrapAdminAccess] DENIED: Invalid secret provided');
        return res.status(403).json({ msg: genericDeniedMsg });
      }
      console.log('[DEBUG bootstrapAdminAccess] Valid secret provided');
    }
    
    if (!req.user?.email) {
      console.log('[DEBUG bootstrapAdminAccess] DENIED: No Supabase session');
      return res.status(401).json({ msg: 'Supabase session required.' });
    }
    
    if (configuredSecret && !isAuthorizedBootstrapUser(req.user)) {
      console.log('[DEBUG bootstrapAdminAccess] DENIED: User not authorized for bootstrap');
      return res.status(403).json({ msg: genericDeniedMsg });
    }

    const email = safeString(req.user.email).toLowerCase();
    console.log('[DEBUG bootstrapAdminAccess] Upserting SaaS user:', email);
    
    const activated = upsertSaasUser({
      email,
      agentId: safeString(req.agentId || req.user?.id || email),
      status: 'active',
      planTerm: 'lifetime',
      expiresAt: null,
      metadata: {
        bootstrap: {
          enabledAt: new Date().toISOString(),
          enabledBy: req.user?.id || null,
        },
        access: {
          allowApp: true,
          allowAdmin: true,
          allowBot: true,
        },
      },
    });

    console.log('[DEBUG bootstrapAdminAccess] Activated user:', {
      email: activated?.email,
      status: activated?.status,
      metadata: activated?.metadata,
    });

    addAdminUser(email);
    console.log('[DEBUG bootstrapAdminAccess] SUCCESSFULLY added to admin list');

    return res.json({
      success: true,
      user: activated,
      msg: 'Admin access enabled for the current session.',
    });
  } catch (error) {
    console.error('[ERROR bootstrapAdminAccess]', {
      message: error.message,
      stack: error.stack,
      userEmail: req.user?.email,
    });
    return res.status(500).json({ msg: 'Failed to bootstrap admin access.' });
  }
};

/**
 * Local login without Supabase dependency
 * USE ONLY FOR DEVELOPMENT/TESTING (when Supabase is unavailable)
 */
exports.localLogin = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' || !isLocalDevAuthEnabled()) {
      return res.status(404).json({ msg: 'Endpoint not available in production.' });
    }

    const email = safeString(req.body?.email).toLowerCase();
    const password = safeString(req.body?.password);

    if (!email || !password) {
      return res.status(400).json({ msg: 'Email and password are required.' });
    }

    if (!email.includes('@')) {
      return res.status(401).json({ msg: 'Invalid email format.' });
    }

    if (password.length < 8) {
      return res.status(401).json({ msg: 'Invalid credentials.' });
    }

    const allowedEmails = getLocalDevAuthAllowedEmails();
    if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
      return res.status(403).json({ msg: 'Email not allowed for local development login.' });
    }

    const session = issueLocalDevSessionToken({
      email,
      agentId: `local-dev:${email}`,
      ttlSeconds: Number(process.env.LOCAL_DEV_AUTH_TTL_SECONDS || 3600),
    });
    
    return res.json({
      success: true,
      token: {
        token: session.token,
        expiresAt: session.expiresAt,
        isDevMode: true,
      },
      user: {
        email,
        kind: 'local-dev-user',
        agentId: session.agentId,
      },
      msg: 'Local login successful (development mode).',
    });
  } catch (error) {
    console.error('[ERROR localLogin]', error);
    return res.status(500).json({ msg: 'Failed to perform local login.' });
  }
};
