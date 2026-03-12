const DEFAULT_BACKEND_CONFIG = {
  backendApiUrl: "https://tcgsolucoes.app/api",
  backendWsUrl: "wss://tcgsolucoes.app/ws",
  backendApiKey: "",
  agentId: "",
};

const STORAGE_KEYS = Object.keys(DEFAULT_BACKEND_CONFIG);
let cachedConfig = { ...DEFAULT_BACKEND_CONFIG };
let readyResolver = null;

function normalizeApiUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_BACKEND_CONFIG.backendApiUrl;
  return raw.replace(/\/+$/, "");
}

function normalizeWsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_BACKEND_CONFIG.backendWsUrl;
  return raw.replace(/\/+$/, "");
}

function applyRawConfig(raw = {}) {
  cachedConfig = {
    backendApiUrl: normalizeApiUrl(raw.backendApiUrl),
    backendWsUrl: normalizeWsUrl(raw.backendWsUrl),
    backendApiKey: String(raw.backendApiKey || "").trim(),
    agentId: String(raw.agentId || "").trim(),
  };
  return { ...cachedConfig };
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local;
}

async function ensureAgentId() {
  if (cachedConfig.agentId) return cachedConfig.agentId;
  const generated = `agent-${Math.random().toString(36).slice(2, 11)}`;
  cachedConfig.agentId = generated;
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set({ agentId: generated }, resolve));
  }
  return generated;
}

export const runtimeConfigReady = new Promise((resolve) => {
  readyResolver = resolve;
  if (!hasChromeStorage()) {
    resolve({ ...cachedConfig });
    return;
  }
  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    applyRawConfig(result || {});
    Promise.resolve(ensureAgentId()).finally(() => resolve({ ...cachedConfig }));
  });
});

if (hasChromeStorage()) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const patch = {};
    for (const key of STORAGE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) {
        patch[key] = changes[key]?.newValue;
      }
    }
    if (Object.keys(patch).length === 0) return;
    applyRawConfig({ ...cachedConfig, ...patch });
  });
}

export async function getRuntimeConfig() {
  await runtimeConfigReady;
  await ensureAgentId();
  return { ...cachedConfig };
}

export function getRuntimeConfigSync() {
  return { ...cachedConfig };
}

export async function getAuthorizedHeaders(extraHeaders = {}, agentIdOverride = "") {
  const config = await getRuntimeConfig();
  const headers = {
    ...extraHeaders,
  };
  if (config.backendApiKey) {
    headers.Authorization = `Bearer ${config.backendApiKey}`;
  }
  const agentId = String(agentIdOverride || config.agentId || "").trim();
  if (agentId) {
    headers["x-agent-id"] = agentId;
  }
  return headers;
}

export async function saveRuntimeConfig(nextValues = {}) {
  const nextConfig = applyRawConfig({ ...cachedConfig, ...nextValues });
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set(nextConfig, resolve));
  }
  return nextConfig;
}

export { DEFAULT_BACKEND_CONFIG, STORAGE_KEYS };
