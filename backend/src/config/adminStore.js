const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/admin-settings.json');
const DEFAULT_STORE = {
  appConfig: {
    backendApiUrl: String(process.env.PUBLIC_API_URL || process.env.BASE_URL || 'https://tcgsolucoes.app/api').trim().replace(/\/+$/, '/api').replace(/\/api\/api$/, '/api'),
    backendWsUrl: String(process.env.PUBLIC_WS_URL || 'wss://tcgsolucoes.app/ws').trim(),
  },
  clients: [],
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
    return {
      appConfig: {
        ...DEFAULT_STORE.appConfig,
        ...(parsed.appConfig || {}),
      },
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
    };
  } catch (error) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
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

module.exports = {
  listClients,
  createClient,
  updateClient,
  rotateClientKey,
  getClientByApiKey,
  touchClient,
  getAppConfig,
  updateAppConfig,
  getProvisionPayload,
};
