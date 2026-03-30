const {
  registerInstallation,
  getInstallationByActivationCode,
  validateInstallationCredentials,
  touchInstallation,
  getAppConfig,
  upsertSaasUser,
  canStartDemoForIp,
} = require('../config/adminStore');
const { emitRealtimeEvent } = require('../realtime/realtime');
const crypto = require('crypto');
const {
  issueInstallationSessionToken,
  getInstallationPublicStatus,
} = require('../utils/auth');

function safeString(value = '') {
  return String(value || '').trim();
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
    return res.json({
      success: true,
      config: {
        backendApiUrl: appConfig.backendApiUrl,
        backendWsUrl: appConfig.backendWsUrl,
        supabase: {
          url: String(process.env.SUPABASE_URL || '').trim(),
          anonKey: String(process.env.SUPABASE_ANON_KEY || '').trim(),
        },
      },
    });
  } catch (error) {
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
