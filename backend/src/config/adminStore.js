const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/admin-settings.json');
const DEFAULT_ADMIN_USERS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((item) => String(item || '').trim().toLowerCase())
  .filter(Boolean);
const DEFAULT_STORE = {
  appConfig: {
    backendApiUrl: String(process.env.PUBLIC_API_URL || process.env.BASE_URL || 'https://tcgsolucoes.app/api').trim().replace(/\/+$/, '/api').replace(/\/api\/api$/, '/api'),
    backendWsUrl: String(process.env.PUBLIC_WS_URL || 'wss://tcgsolucoes.app/ws').trim(),
  },
  clients: [],
  installations: [],
  saasUsers: [],
  trialGuards: [],
  adminUsers: DEFAULT_ADMIN_USERS,
};

const PLAN_TERMS = {
  demo: 7,
  '30d': 30,
  '60d': 60,
  '12m': 365,
  '365d': 365,
  lifetime: null,
};

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2));
  }
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const store = {
      appConfig: {
        ...DEFAULT_STORE.appConfig,
        ...(parsed.appConfig || {}),
      },
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      installations: Array.isArray(parsed.installations)
        ? parsed.installations
        : [],
      saasUsers: Array.isArray(parsed.saasUsers)
        ? parsed.saasUsers
        : [],
      trialGuards: Array.isArray(parsed.trialGuards)
        ? parsed.trialGuards
        : [],
      adminUsers: Array.isArray(parsed.adminUsers)
        ? parsed.adminUsers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [...DEFAULT_ADMIN_USERS],
    };
    const sanitized = sanitizeStore(store);
    if (sanitized.changed) {
      writeStore(sanitized.store);
    }
    return sanitized.store;
  } catch (error) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function sanitizeStore(store = {}) {
  let changed = false;
  const nextStore = {
    ...store,
    saasUsers: Array.isArray(store.saasUsers) ? store.saasUsers.slice() : [],
  };

  nextStore.saasUsers = nextStore.saasUsers.map((item) => {
    const safeItem = item && typeof item === 'object' ? { ...item } : {};
    const status = normalizeSaasUserStatus(safeItem.status);
    const metadata = safeItem.metadata && typeof safeItem.metadata === 'object'
      ? { ...safeItem.metadata }
      : {};

    if (status === 'pending' && !metadata.requestedAt) {
      metadata.requestedAt = safeItem.createdAt || safeItem.updatedAt || new Date().toISOString();
      changed = true;
    }

    if (safeItem.metadata !== metadata) {
      changed = true;
    }

    return {
      ...safeItem,
      status,
      metadata,
    };
  });

  return { store: nextStore, changed };
}

function listAdminUsers() {
  const store = readStore();
  const entries = Array.isArray(store.adminUsers) ? store.adminUsers : [];
  return Array.from(new Set(entries.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)));
}

function isAdminEmail(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return false;
  return listAdminUsers().includes(safeEmail);
}

function addAdminUser(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return null;
  const store = readStore();
  const list = Array.isArray(store.adminUsers) ? store.adminUsers : [];
  if (!list.includes(safeEmail)) {
    list.push(safeEmail);
    store.adminUsers = list;
    writeStore(store);
  }
  return safeEmail;
}

function removeAdminUser(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return false;
  const store = readStore();
  const list = Array.isArray(store.adminUsers) ? store.adminUsers : [];
  const next = list.filter((item) => String(item || '').trim().toLowerCase() !== safeEmail);
  if (next.length === list.length) return false;
  store.adminUsers = next;
  writeStore(store);
  return true;
}

function normalizeSaasUserStatus(value = '') {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'pending' || safe === 'awaiting_approval' || safe === 'aguardando') return 'pending';
  if (safe === 'suspended' || safe === 'blocked') return 'suspended';
  if (safe === 'deleted' || safe === 'removed') return 'deleted';
  return 'active';
}

function normalizeSaasUser(entry = {}) {
  const email = String(entry.email || '').trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    agentId: String(entry.agentId || entry.clientId || '').trim(),
    status: normalizeSaasUserStatus(entry.status),
    clientId: String(entry.clientId || '').trim() || null,
    activationCode: String(entry.activationCode || '').trim().toUpperCase() || null,
    planTerm: entry.planTerm ? normalizePlanTerm(entry.planTerm) : null,
    expiresAt: entry.expiresAt || null,
    activatedAt: entry.activatedAt || null,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    lastLoginAt: entry.lastLoginAt || null,
    metadata: entry.metadata || {},
  };
}

function normalizeIpAddress(value = '') {
  const safe = String(value || '').trim();
  if (!safe) return '';
  return safe.replace(/^::ffff:/, '');
}

function canStartDemoForIp(ip = '') {
  const safeIp = normalizeIpAddress(ip);
  if (!safeIp) return { allowed: true };
  const store = readStore();
  const guard = (store.trialGuards || []).find((item) => normalizeIpAddress(item.ip) === safeIp);
  if (guard && guard.blocked === true) {
    return {
      allowed: false,
      reason: 'demo_already_used',
      msg: 'Período DEMO já utilizado neste IP. Para continuar, selecione um plano pago de teste.',
    };
  }
  return { allowed: true };
}

function markDemoAsConsumedByIp(ip = '', email = '') {
  const safeIp = normalizeIpAddress(ip);
  if (!safeIp) return;
  const store = readStore();
  store.trialGuards = Array.isArray(store.trialGuards) ? store.trialGuards : [];
  const index = store.trialGuards.findIndex((item) => normalizeIpAddress(item.ip) === safeIp);
  const now = new Date().toISOString();
  const next = {
    ip: safeIp,
    email: String(email || '').trim().toLowerCase() || null,
    blocked: true,
    blockedAt: now,
    reason: 'demo_already_used',
  };
  if (index >= 0) {
    store.trialGuards[index] = {
      ...(store.trialGuards[index] || {}),
      ...next,
    };
  } else {
    store.trialGuards.unshift(next);
  }
  writeStore(store);
}

function getSaasUserByEmail(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return null;
  const store = readStore();
  const match = (store.saasUsers || []).find((item) => String(item.email || '').trim().toLowerCase() === safeEmail);
  if (!match) return null;
  return normalizeSaasUser(match);
}

function listSaasUsers(filters = {}) {
  const store = readStore();
  const statusFilter = String(filters.status || '').trim().toLowerCase();
  const items = (store.saasUsers || [])
    .map(normalizeSaasUser)
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  if (!statusFilter) return items;
  return items.filter((item) => item.status === statusFilter);
}

function upsertSaasUser(payload = {}) {
  const store = readStore();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('email is required');
  }

  const now = new Date().toISOString();
  const normalizedStatus = normalizeSaasUserStatus(payload.status);
  const activationCode = String(payload.activationCode || '').trim().toUpperCase();
  let clientId = String(payload.clientId || '').trim();
  let inferredPlanTerm = payload.planTerm ? normalizePlanTerm(payload.planTerm) : null;
  let inferredExpiresAt = payload.expiresAt || null;

  if (activationCode) {
    const installation = findInstallationByCode(store, activationCode);
    if (installation) {
      clientId = clientId || String(installation.clientId || '').trim();
      inferredPlanTerm = inferredPlanTerm || normalizePlanTerm(installation.planTerm || 'demo');
      inferredExpiresAt = inferredExpiresAt || installation.expiresAt || null;
    }
  }

  const index = (store.saasUsers || []).findIndex((item) => String(item.email || '').trim().toLowerCase() === email);
  const base = index >= 0 ? store.saasUsers[index] : null;

  // Criptografia extra implementada: ID único indestrutível bot_ XXX
  let finalAgentId = base?.agentId;
  if (!finalAgentId) {
    if (payload.agentId && String(payload.agentId).startsWith('bot_')) {
      finalAgentId = payload.agentId; // Aceita de origens server-side seguras 
    } else {
      const crypto = require('crypto');
      finalAgentId = `bot_${crypto.randomBytes(4).toString('hex')}_${Date.now().toString(36).slice(-4)}`;
    }
  }

  const nextItem = {
    email,
    agentId: finalAgentId,
    status: normalizedStatus,
    clientId: clientId || base?.clientId || null,
    activationCode: activationCode || base?.activationCode || null,
    planTerm: inferredPlanTerm || base?.planTerm || null,
    expiresAt: inferredExpiresAt || base?.expiresAt || null,
    activatedAt: base?.activatedAt || null,
    createdAt: base?.createdAt || now,
    updatedAt: now,
    lastLoginAt: base?.lastLoginAt || null,
    metadata: {
      ...(base?.metadata || {}),
      ...(payload.metadata || {}),
    },
  };

  if (nextItem.status === 'active') {
    const requestedPlan = normalizePlanTerm(nextItem.planTerm || nextItem.metadata?.desiredPlan || '30d');
    nextItem.planTerm = requestedPlan;
    nextItem.activatedAt = nextItem.activatedAt || now;
    if (requestedPlan === 'demo') {
      nextItem.expiresAt = buildExpiration('demo', now);
      nextItem.metadata = {
        ...(nextItem.metadata || {}),
        demoLimit: {
          maxMessages: 10,
          mode: 'single-flight',
        },
        demoConsumedAt: now,
      };
      markDemoAsConsumedByIp(nextItem.metadata?.requestIp || nextItem.metadata?.ip || '', email);
    } else {
      nextItem.expiresAt = buildExpiration('30d', now);
      nextItem.metadata = {
        ...(nextItem.metadata || {}),
        activationPolicy: 'sandbox_30d',
      };
    }
  }

  if (index >= 0) {
    store.saasUsers[index] = nextItem;
  } else {
    store.saasUsers = Array.isArray(store.saasUsers) ? store.saasUsers : [];
    store.saasUsers.unshift(nextItem);
  }

  writeStore(store);
  return normalizeSaasUser(nextItem);
}

function deleteSaasUser(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return false;
  const store = readStore();
  const before = (store.saasUsers || []).length;
  store.saasUsers = (store.saasUsers || []).filter((item) => String(item.email || '').trim().toLowerCase() !== safeEmail);
  if (store.saasUsers.length === before) return false;
  writeStore(store);
  return true;
}

function touchSaasUserLogin(email = '', metadata = {}) {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return null;
  const store = readStore();
  const entry = (store.saasUsers || []).find((item) => String(item.email || '').trim().toLowerCase() === safeEmail);
  if (!entry) return null;
  entry.lastLoginAt = new Date().toISOString();
  entry.updatedAt = entry.lastLoginAt;
  entry.metadata = {
    ...(entry.metadata || {}),
    ...(metadata || {}),
  };
  writeStore(store);
  return normalizeSaasUser(entry);
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  return store;
}

function generateClientId() {
  return `bot_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function generateApiKey() {
  return crypto.randomBytes(24).toString('hex');
}

function generateActivationCode() {
  const chunk = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EW-${chunk()}-${chunk()}-${chunk()}`;
}

function normalizePlanTerm(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'demo' || safe === 'trial' || safe === '7d') return 'demo';
  if (safe === '30' || safe === '30d') return '30d';
  if (safe === '60' || safe === '60d') return '60d';
  if (safe === '90' || safe === '90d') return '60d';
  if (safe === '12m' || safe === '12' || safe === '365' || safe === '365d' || safe === 'annual' || safe === '1y') return '12m';
  if (safe === 'lifetime' || safe === 'vitalicio' || safe === 'lifelong') return 'lifetime';
  return 'demo';
}

function buildExpiration(planTerm, startedAt = new Date()) {
  const normalized = normalizePlanTerm(planTerm);
  const days = PLAN_TERMS[normalized];
  if (days === null) return null;
  const base = new Date(startedAt);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function normalizeInstallationStatus(installation = {}) {
  if (installation.status === 'revoked' || installation.status === 'suspended') {
    return installation.status;
  }
  if (!installation.activatedAt) {
    return 'pending';
  }
  if (installation.expiresAt && new Date(installation.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

function maskInstallationSecret(secret = '') {
  const safe = String(secret || '').trim();
  if (!safe) return '';
  if (safe.length <= 8) return `${safe.slice(0, 2)}***`;
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
}

function getPublicInstallation(installation) {
  const status = normalizeInstallationStatus(installation);
  const normalizedPlanTerm = normalizePlanTerm(installation.planTerm || '');
  return {
    activationCode: installation.activationCode,
    installationId: installation.installationId,
    status,
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
    activatedAt: installation.activatedAt || null,
    revokedAt: installation.revokedAt || null,
    suspendedAt: installation.suspendedAt || null,
    expiresAt: installation.expiresAt || null,
    planTerm: normalizedPlanTerm || null,
    isDemo: normalizedPlanTerm === 'demo',
    isLifetime: installation.planTerm === 'lifetime',
    lastSeenAt: installation.lastSeenAt || null,
    notes: installation.notes || '',
    installationSecretMasked: maskInstallationSecret(installation.installationSecret),
    metadata: installation.metadata || {},
    permissions: normalizePermissions(installation.permissions),
    clientId: installation.clientId || null,
  };
}

function ensureInstallationClient(store, installation, payload = {}) {
  if (installation.clientId) {
    return store.clients.find((item) => item.clientId === installation.clientId) || null;
  }
  const client = {
    clientId: generateClientId(),
    name: String(payload.name || installation.metadata?.name || `Cliente ${installation.activationCode}`).trim(),
    description: String(payload.description || installation.notes || '').trim(),
    active: true,
    permissions: normalizePermissions(payload.permissions || installation.permissions),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  store.clients.unshift(client);
  installation.clientId = client.clientId;
  return client;
}

function normalizePermissions(raw = {}) {
  return {
    allowGemini: raw.allowGemini !== false,
    allowRealtime: raw.allowRealtime !== false,
    allowCampaigns: raw.allowCampaigns !== false,
    allowContacts: raw.allowContacts !== false,
    allowInbox: raw.allowInbox !== false,
  };
}

function maskApiKey(apiKey = '') {
  const safe = String(apiKey || '').trim();
  if (!safe) return '';
  if (safe.length <= 8) return `${safe.slice(0, 2)}***`;
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
}

function getPublicClient(client) {
  return {
    clientId: client.clientId,
    name: client.name,
    description: client.description || '',
    active: client.active !== false,
    permissions: normalizePermissions(client.permissions),
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    lastUsedAt: client.lastUsedAt || null,
    apiKeyMasked: maskApiKey(client.apiKey),
  };
}

function listClients() {
  const store = readStore();
  return store.clients.map(getPublicClient);
}

function createClient(payload = {}) {
  const store = readStore();
  const client = {
    clientId: generateClientId(),
    name: String(payload.name || 'Novo bot').trim(),
    description: String(payload.description || '').trim(),
    active: payload.active !== false,
    permissions: normalizePermissions(payload.permissions),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  store.clients.unshift(client);
  writeStore(store);
  return {
    ...getPublicClient(client),
    apiKey: client.apiKey,
  };
}

function updateClient(clientId, payload = {}) {
  const store = readStore();
  const index = store.clients.findIndex((item) => item.clientId === clientId);
  if (index < 0) return null;
  const current = store.clients[index];
  store.clients[index] = {
    ...current,
    name: payload.name !== undefined ? String(payload.name || '').trim() : current.name,
    description: payload.description !== undefined ? String(payload.description || '').trim() : current.description,
    active: payload.active !== undefined ? payload.active !== false : current.active,
    permissions: payload.permissions ? normalizePermissions(payload.permissions) : normalizePermissions(current.permissions),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return getPublicClient(store.clients[index]);
}

function rotateClientKey(clientId) {
  const store = readStore();
  const client = store.clients.find((item) => item.clientId === clientId);
  if (!client) return null;
  client.apiKey = generateApiKey();
  client.updatedAt = new Date().toISOString();
  writeStore(store);
  return {
    ...getPublicClient(client),
    apiKey: client.apiKey,
  };
}

function deleteClient(clientId) {
  const store = readStore();
  const index = store.clients.findIndex((item) => item.clientId === clientId);
  if (index < 0) return false;
  store.clients.splice(index, 1);
  store.installations = store.installations.map((installation) => {
    if (installation.clientId === clientId) {
      return {
        ...installation,
        clientId: null,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
    }
    return installation;
  });
  writeStore(store);
  return true;
}

function getClientByApiKey(apiKey = '') {
  const store = readStore();
  const client = store.clients.find((item) => item.apiKey === apiKey && item.active !== false);
  return client || null;
}

function touchClient(clientId) {
  const store = readStore();
  const client = store.clients.find((item) => item.clientId === clientId);
  if (!client) return null;
  client.lastUsedAt = new Date().toISOString();
  writeStore(store);
  return getPublicClient(client);
}

function getAppConfig() {
  const store = readStore();
  return { ...DEFAULT_STORE.appConfig, ...(store.appConfig || {}) };
}

function updateAppConfig(payload = {}) {
  const store = readStore();
  const nextConfig = {
    ...getAppConfig(),
    backendApiUrl: String(payload.backendApiUrl || getAppConfig().backendApiUrl).trim(),
    backendWsUrl: String(payload.backendWsUrl || getAppConfig().backendWsUrl).trim(),
  };
  store.appConfig = nextConfig;
  writeStore(store);
  return nextConfig;
}

function getProvisionPayload(clientId) {
  const store = readStore();
  const client = store.clients.find((item) => item.clientId === clientId);
  if (!client) return null;
  return {
    clientId: client.clientId,
    name: client.name,
    backendApiUrl: store.appConfig?.backendApiUrl || DEFAULT_STORE.appConfig.backendApiUrl,
    backendWsUrl: store.appConfig?.backendWsUrl || DEFAULT_STORE.appConfig.backendWsUrl,
    backendApiKey: client.apiKey,
    agentId: client.clientId,
    permissions: normalizePermissions(client.permissions),
  };
}

function findInstallationByCode(store, activationCode = '') {
  const safeCode = String(activationCode || '').trim().toUpperCase();
  if (!safeCode) return null;
  return store.installations.find((item) => String(item.activationCode || '').trim().toUpperCase() === safeCode) || null;
}

function registerInstallation(payload = {}) {
  const store = readStore();
  const activationCode = String(payload.activationCode || generateActivationCode()).trim().toUpperCase();
  const installationId = String(payload.installationId || '').trim();
  const installationSecret = String(payload.installationSecret || '').trim();
  if (!installationId || !installationSecret || !activationCode) {
    throw new Error('activationCode, installationId and installationSecret are required');
  }
  let installation = findInstallationByCode(store, activationCode);
  if (!installation) {
    installation = {
      activationCode,
      installationId,
      installationSecret,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
      activatedAt: null,
      expiresAt: null,
      planTerm: null,
      revokedAt: null,
      suspendedAt: null,
      notes: '',
      metadata: payload.metadata || {},
      permissions: normalizePermissions({}),
      clientId: null,
      lastSeenAt: null,
    };
    store.installations.unshift(installation);
  } else {
    installation.installationId = installationId;
    installation.installationSecret = installationSecret;
    installation.metadata = {
      ...(installation.metadata || {}),
      ...(payload.metadata || {}),
    };
    installation.updatedAt = new Date().toISOString();
    if (installation.status === 'expired') {
      installation.status = 'pending';
      installation.expiresAt = null;
      installation.activatedAt = null;
      installation.planTerm = null;
    }
  }
  writeStore(store);
  return getPublicInstallation(installation);
}

function listInstallations(filters = {}) {
  const store = readStore();
  const statusFilter = String(filters.status || '').trim().toLowerCase();
  const all = store.installations.map((item) => {
    item.status = normalizeInstallationStatus(item);
    return item;
  });
  writeStore(store);
  let list = all;
  if (statusFilter) {
    list = all.filter((item) => normalizeInstallationStatus(item) === statusFilter);
  }
  return list
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
    .map(getPublicInstallation);
}

function activateInstallation(activationCode, payload = {}) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  const now = new Date();
  const planTerm = normalizePlanTerm(payload.planTerm || installation.planTerm || 'demo');
  const permissions = normalizePermissions(payload.permissions || installation.permissions || {});
  const client = ensureInstallationClient(store, installation, payload);
  if (client) {
    client.permissions = permissions;
    client.active = true;
    client.updatedAt = now.toISOString();
  }
  installation.permissions = permissions;
  installation.status = 'active';
  installation.planTerm = planTerm;
  installation.activatedAt = installation.activatedAt || now.toISOString();
  installation.expiresAt = buildExpiration(planTerm, now);
  installation.revokedAt = null;
  installation.suspendedAt = null;
  installation.notes = String(payload.notes || installation.notes || '').trim();
  installation.updatedAt = now.toISOString();
  writeStore(store);
  return getPublicInstallation(installation);
}

function revokeInstallation(activationCode, payload = {}) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  installation.status = String(payload.status || 'revoked').trim().toLowerCase() === 'suspended' ? 'suspended' : 'revoked';
  installation.revokedAt = installation.status === 'revoked' ? new Date().toISOString() : installation.revokedAt;
  installation.suspendedAt = installation.status === 'suspended' ? new Date().toISOString() : installation.suspendedAt;
  installation.updatedAt = new Date().toISOString();
  if (installation.clientId) {
    const client = store.clients.find((item) => item.clientId === installation.clientId);
    if (client) {
      client.active = false;
      client.updatedAt = new Date().toISOString();
    }
  }
  writeStore(store);
  return getPublicInstallation(installation);
}

function deleteInstallation(activationCode, payload = {}) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  const removeClient = payload.removeClient === true;
  const targetClientId = installation.clientId || null;
  store.installations = store.installations.filter(
    (item) => String(item.activationCode || '').trim().toUpperCase() !== String(activationCode || '').trim().toUpperCase(),
  );
  if (targetClientId) {
    if (removeClient) {
      store.clients = store.clients.filter((client) => client.clientId !== targetClientId);
    } else {
      const client = store.clients.find((item) => item.clientId === targetClientId);
      if (client) {
        client.active = false;
        client.updatedAt = new Date().toISOString();
      }
    }
  }
  writeStore(store);
  return {
    activationCode: String(activationCode || '').trim().toUpperCase(),
    removedClient: removeClient ? targetClientId : null,
  };
}

function getInstallationByActivationCode(activationCode) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  installation.status = normalizeInstallationStatus(installation);
  writeStore(store);
  return installation;
}

function validateInstallationCredentials(activationCode, installationSecret) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  const safeSecret = String(installationSecret || '').trim();
  if (!safeSecret || safeSecret !== String(installation.installationSecret || '').trim()) {
    return null;
  }
  const status = normalizeInstallationStatus(installation);
  installation.status = status;
  installation.updatedAt = new Date().toISOString();
  writeStore(store);
  if (status !== 'active') return null;
  return installation;
}

function touchInstallation(activationCode, metadata = {}) {
  const store = readStore();
  const installation = findInstallationByCode(store, activationCode);
  if (!installation) return null;
  installation.lastSeenAt = new Date().toISOString();
  installation.updatedAt = installation.lastSeenAt;
  installation.metadata = {
    ...(installation.metadata || {}),
    ...(metadata || {}),
  };
  writeStore(store);
  return getPublicInstallation(installation);
}

module.exports = { readStore,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  rotateClientKey,
  getClientByApiKey,
  touchClient,
  getAppConfig,
  updateAppConfig,
  getProvisionPayload,
  listInstallations,
  registerInstallation,
  activateInstallation,
  revokeInstallation,
  deleteInstallation,
  getInstallationByActivationCode,
  validateInstallationCredentials,
  touchInstallation,
  normalizePlanTerm,
  buildExpiration,
  listAdminUsers,
  isAdminEmail,
  addAdminUser,
  removeAdminUser,
  listSaasUsers,
  getSaasUserByEmail,
  upsertSaasUser,
  deleteSaasUser,
  touchSaasUserLogin,
  canStartDemoForIp,
};
