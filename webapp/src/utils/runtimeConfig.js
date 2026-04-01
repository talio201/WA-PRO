/**
 * Webapp shim for extension's runtimeConfig.
 * Uses Supabase session instead of chrome.storage / activation codes.
 */
import { ensureSupabase } from '../auth/AuthContext.jsx';

const BACKEND_URL = String(window.location.origin);
const API_URL = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace(/^http/, 'ws') + '/ws';

export const DEFAULT_BACKEND_CONFIG = {
  backendApiUrl: API_URL,
  backendWsUrl: WS_URL,
  backendApiKey: '',
  agentId: localStorage.getItem('emidia_agent_id') || '',
  activationCode: '',
  installationId: '',
  installationSecret: '',
  licenseStatus: 'active',
  planTerm: 'web',
  expiresAt: '',
  accessToken: '',
  accessTokenExpiresAt: '',
};

export const STORAGE_KEYS = Object.keys(DEFAULT_BACKEND_CONFIG);

export const runtimeConfigReady = Promise.resolve(DEFAULT_BACKEND_CONFIG);

export async function getRuntimeConfig() {
  const agentId = localStorage.getItem('emidia_agent_id') || '';
  return {
    ...DEFAULT_BACKEND_CONFIG,
    agentId,
  };
}

export function getRuntimeConfigSync() {
  const agentId = localStorage.getItem('emidia_agent_id') || '';
  return { ...DEFAULT_BACKEND_CONFIG, agentId };
}

export async function getAuthorizedHeaders(extraHeaders = {}, agentIdOverride = '') {
  const sb = await ensureSupabase();
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token || '';
  const localAgentId = String(localStorage.getItem('emidia_agent_id') || '').trim();
  const sessionUser = data?.session?.user;
  const sessionAgentId = String(sessionUser?.user_metadata?.agentId || '').trim();
  const userIdPrefix = String(sessionUser?.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 12);
  const fallbackAgentId = userIdPrefix ? `user_${userIdPrefix}` : '';
  const agentId = (extraHeaders && extraHeaders['x-agent-id']) || agentIdOverride || localAgentId || sessionAgentId || fallbackAgentId;
  const headers = { ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (agentId) headers['x-agent-id'] = agentId;
  return headers;
}

export async function saveRuntimeConfig(values = {}) {
  // Persist relevant fields to localStorage for compatibility
  if (values.agentId) localStorage.setItem('emidia_agent_id', values.agentId);
  return { ...DEFAULT_BACKEND_CONFIG, ...values };
}

export async function ensureSessionToken() {
  const sb = await ensureSupabase();
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token || '';
  if (!token) throw new Error('Sessão Supabase não encontrada. Faça login novamente.');
  return { token, legacy: false };
}

export async function ensureInstallationRegistration() {
  // No-op in webapp context
}

export async function syncActivationStatus() {
  return { status: 'active', planTerm: 'web', expiresAt: '' };
}
