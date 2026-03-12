const DEFAULT_BACKEND_CONFIG = {
  backendApiUrl: 'https://tcgsolucoes.app/api',
  backendWsUrl: 'wss://tcgsolucoes.app/ws',
  backendApiKey: '',
  agentId: '',
  activationCode: '',
  installationId: '',
  installationSecret: '',
  licenseStatus: 'pending',
  planTerm: '',
  expiresAt: '',
  accessToken: '',
  accessTokenExpiresAt: '',
};

const STORAGE_KEYS = Object.keys(DEFAULT_BACKEND_CONFIG);
let cachedConfig = { ...DEFAULT_BACKEND_CONFIG };

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

function randomHex(bytes = 16) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 2 + bytes * 2)}`;
}

function generateActivationCode() {
  const block = () => randomHex(3).toUpperCase();
  return `EW-${block()}-${block()}-${block()}`;
}

function normalizeApiUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BACKEND_CONFIG.backendApiUrl;
  return raw.replace(/\/+$/, '');
}

function normalizeWsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BACKEND_CONFIG.backendWsUrl;
  return raw.replace(/\/+$/, '');
}

function applyRawConfig(raw = {}) {
  cachedConfig = {
    ...cachedConfig,
    backendApiUrl: normalizeApiUrl(raw.backendApiUrl ?? cachedConfig.backendApiUrl),
    backendWsUrl: normalizeWsUrl(raw.backendWsUrl ?? cachedConfig.backendWsUrl),
    backendApiKey: String((raw.backendApiKey ?? cachedConfig.backendApiKey) || '').trim(),
    agentId: String((raw.agentId ?? cachedConfig.agentId) || '').trim(),
    activationCode: String((raw.activationCode ?? cachedConfig.activationCode) || '').trim().toUpperCase(),
    installationId: String((raw.installationId ?? cachedConfig.installationId) || '').trim(),
    installationSecret: String((raw.installationSecret ?? cachedConfig.installationSecret) || '').trim(),
    licenseStatus: String((raw.licenseStatus ?? cachedConfig.licenseStatus) || 'pending').trim().toLowerCase(),
    planTerm: String((raw.planTerm ?? cachedConfig.planTerm) || '').trim(),
    expiresAt: String((raw.expiresAt ?? cachedConfig.expiresAt) || '').trim(),
    accessToken: String((raw.accessToken ?? cachedConfig.accessToken) || '').trim(),
    accessTokenExpiresAt: String((raw.accessTokenExpiresAt ?? cachedConfig.accessTokenExpiresAt) || '').trim(),
  };
  return { ...cachedConfig };
}

async function saveToStorage(patch = {}) {
  applyRawConfig(patch);
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set({ ...cachedConfig }, resolve));
  }
  return { ...cachedConfig };
}

async function ensureInstallationIdentity() {
  const patch = {};
  if (!cachedConfig.installationId) patch.installationId = `ins_${randomHex(16)}`;
  if (!cachedConfig.installationSecret) patch.installationSecret = randomHex(24);
  if (!cachedConfig.activationCode) patch.activationCode = generateActivationCode();
  if (!cachedConfig.agentId) patch.agentId = patch.installationId || cachedConfig.installationId || `agent_${randomHex(8)}`;
  if (Object.keys(patch).length > 0) {
    await saveToStorage(patch);
  }
  return { ...cachedConfig };
}

async function requestPublicJson(pathname, options = {}) {
  const response = await fetch(`${cachedConfig.backendApiUrl}${pathname}`, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {}
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || `Public request failed (${response.status})`);
  }
  return payload;
}

let registerInFlight = null;
export async function ensureInstallationRegistration() {
  if (registerInFlight) return registerInFlight;
  registerInFlight = (async () => {
    await ensureInstallationIdentity();
    const payload = {
      activationCode: cachedConfig.activationCode,
      installationId: cachedConfig.installationId,
      installationSecret: cachedConfig.installationSecret,
      metadata: {
        source: 'extension',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      },
    };
    try {
      await requestPublicJson('/public/installations/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {}
  })();
  try {
    await registerInFlight;
  } finally {
    registerInFlight = null;
  }
}

export async function syncActivationStatus() {
  await ensureInstallationRegistration();
  try {
    const response = await requestPublicJson(`/public/installations/${encodeURIComponent(cachedConfig.activationCode)}/status`);
    const status = response?.status || {};
    await saveToStorage({
      licenseStatus: String(status.status || 'pending').toLowerCase(),
      planTerm: String(status.planTerm || ''),
      expiresAt: String(status.expiresAt || ''),
    });
    return status;
  } catch (error) {
    return {
      status: cachedConfig.licenseStatus || 'pending',
      planTerm: cachedConfig.planTerm || '',
      expiresAt: cachedConfig.expiresAt || '',
    };
  }
}

function hasValidSessionToken(config = cachedConfig) {
  const token = String(config.accessToken || '').trim();
  if (!token) return false;
  const expiresAt = new Date(config.accessTokenExpiresAt || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt - Date.now() > 30 * 1000;
}

let sessionInFlight = null;
export async function ensureSessionToken() {
  await ensureInstallationRegistration();
  if (cachedConfig.backendApiKey) {
    return { token: cachedConfig.backendApiKey, legacy: true };
  }
  if (hasValidSessionToken()) {
    return { token: cachedConfig.accessToken, legacy: false };
  }
  if (sessionInFlight) return sessionInFlight;

  sessionInFlight = (async () => {
    const status = await syncActivationStatus();
    const normalizedStatus = String(status?.status || 'pending').toLowerCase();
    if (normalizedStatus !== 'active') {
      await saveToStorage({ accessToken: '', accessTokenExpiresAt: '' });
      throw new Error('Licença pendente de ativação no painel admin.');
    }

    const response = await requestPublicJson('/public/installations/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activationCode: cachedConfig.activationCode,
        installationSecret: cachedConfig.installationSecret,
      }),
    });

    const session = response?.session || {};
    await saveToStorage({
      accessToken: String(session.token || '').trim(),
      accessTokenExpiresAt: String(session.expiresAt || '').trim(),
      agentId: String(session.agentId || cachedConfig.agentId || '').trim(),
      backendApiUrl: String(session.config?.backendApiUrl || cachedConfig.backendApiUrl || '').trim(),
      backendWsUrl: String(session.config?.backendWsUrl || cachedConfig.backendWsUrl || '').trim(),
      licenseStatus: 'active',
      planTerm: String(session.planTerm || cachedConfig.planTerm || ''),
      expiresAt: String(session.licenseExpiresAt || cachedConfig.expiresAt || ''),
    });

    return {
      token: cachedConfig.accessToken,
      legacy: false,
    };
  })();

  try {
    return await sessionInFlight;
  } finally {
    sessionInFlight = null;
  }
}

export const runtimeConfigReady = new Promise((resolve) => {
  if (!hasChromeStorage()) {
    ensureInstallationIdentity().finally(() => resolve({ ...cachedConfig }));
    return;
  }

  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    applyRawConfig(result || {});
    ensureInstallationIdentity().finally(() => resolve({ ...cachedConfig }));
  });
});

if (hasChromeStorage()) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const patch = {};
    for (const key of STORAGE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        patch[key] = changes[key]?.newValue;
      }
    }
    if (Object.keys(patch).length > 0) {
      applyRawConfig({ ...cachedConfig, ...patch });
    }
  });
}

export async function getRuntimeConfig() {
  await runtimeConfigReady;
  await ensureInstallationIdentity();
  return { ...cachedConfig };
}

export function getRuntimeConfigSync() {
  return { ...cachedConfig };
}

export async function getAuthorizedHeaders(extraHeaders = {}, agentIdOverride = '') {
  const config = await getRuntimeConfig();
  const headers = {
    ...extraHeaders,
  };

  let token = '';
  try {
    const session = await ensureSessionToken();
    token = session?.token || '';
  } catch (error) {
    token = config.backendApiKey || '';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const agentId = String(agentIdOverride || config.agentId || config.installationId || '').trim();
  if (agentId) {
    headers['x-agent-id'] = agentId;
  }
  return headers;
}

export async function saveRuntimeConfig(nextValues = {}) {
  return saveToStorage(nextValues || {});
}

export {
  DEFAULT_BACKEND_CONFIG,
  STORAGE_KEYS,
};
