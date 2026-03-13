/**
 * Webapp api.js — identical to extension but imports from webapp runtimeConfig shim.
 */
import { getAuthorizedHeaders, getRuntimeConfig, saveRuntimeConfig } from './runtimeConfig.js';

const parseResponsePayload = async (response) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { msg: text } : {};
};

const requestJson = async (path, options = {}, fallbackMessage = 'Request failed') => {
  const { backendApiUrl } = await getRuntimeConfig();
  const url = `${backendApiUrl}${String(path || '')}`;

  const execute = async () => {
    const mergedHeaders = await getAuthorizedHeaders(options.headers || {});
    const response = await fetch(url, { ...options, headers: mergedHeaders });
    const payload = await parseResponsePayload(response);
    return { response, payload };
  };

  let { response, payload } = await execute();

  if (response.status === 401) {
    await saveRuntimeConfig({ accessToken: '', accessTokenExpiresAt: '' });
    ({ response, payload } = await execute());
  }

  if (!response.ok) throw new Error(payload?.msg || payload?.message || fallbackMessage);
  return payload;
};

export const getCampaigns = async () => {
  try { return await requestJson('/campaigns', {}, 'Failed to fetch campaigns'); }
  catch (e) { console.error('API Error:', e); return []; }
};
export const getMessages = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  return requestJson(`/messages${q.toString() ? `?${q}` : ''}`, {}, 'Failed to fetch messages');
};
export const getConversations = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  return requestJson(`/messages/conversations${q.toString() ? `?${q}` : ''}`, {}, 'Failed to fetch conversations');
};
export const getHelpdeskQueues = async (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  return requestJson(`/messages/helpdesk/queues${q.toString() ? `?${q}` : ''}`, {}, 'Failed to fetch helpdesk queues');
};
export const getConversationHistory = async (phone, params = {}) => {
  const safePhone = String(phone || '').trim();
  if (!safePhone) throw new Error('Phone is required.');
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  return requestJson(`/messages/conversations/${encodeURIComponent(safePhone)}/history${q.toString() ? `?${q}` : ''}`, {}, 'Failed to fetch conversation history');
};
export const syncConversationHistory = async (phone, payload = {}) => {
  const safePhone = String(phone || '').trim();
  if (!safePhone) throw new Error('Phone is required.');
  return requestJson(`/messages/conversations/${encodeURIComponent(safePhone)}/history/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to sync conversation history');
};
export const createCampaign = async (data) =>
  requestJson('/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, 'Failed to create campaign');
export const uploadFile = async (file) => {
  const fd = new FormData(); fd.append('file', file);
  return requestJson('/upload', { method: 'POST', body: fd }, 'Failed to upload file');
};
export const deleteCampaign = async (id) => requestJson(`/campaigns/${id}`, { method: 'DELETE' }, 'Failed to delete campaign');
export const getCampaignFailures = async (id) => requestJson(`/campaigns/${id}/failures`, {}, 'Failed to fetch campaign failures');
export const getMessageAudit = async (id) => requestJson(`/messages/${id}/audit`, {}, 'Failed to fetch message audit');
export const updateMessage = async (id, payload) => requestJson(`/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to update message');
export const retryMessage = async (id, payload = {}) => requestJson(`/messages/${id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to retry message');
export const assignConversation = async (phone, payload) => requestJson(`/messages/conversations/${encodeURIComponent(phone)}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }, 'Failed to assign conversation');
export const releaseConversation = async (phone, payload = {}) => requestJson(`/messages/conversations/${encodeURIComponent(phone)}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to release conversation');
export const transferConversation = async (phone, payload = {}) => requestJson(`/messages/conversations/${encodeURIComponent(phone)}/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to transfer conversation');
export const getConversationProtocols = async (phone) => requestJson(`/messages/conversations/${encodeURIComponent(phone)}/protocols`, {}, 'Failed to fetch conversation protocols');
export const openConversationProtocol = async (phone, payload = {}) => requestJson(`/messages/conversations/${encodeURIComponent(phone)}/protocols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to open support protocol');
export const updateConversationProtocolStatus = async (id, payload = {}) => requestJson(`/messages/protocols/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to update support protocol');
export const registerInboundMessage = async (payload = {}) => requestJson('/messages/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to register inbound message');
export const registerManualOutbound = async (payload = {}) => requestJson('/messages/outbound/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to register manual outbound message');
export const generateMessageVariants = async ({ message, count = 5 }) => requestJson('/ai/generate-variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, count }) }, 'Failed to generate message variants');
export const requestConversationHistorySync = async (phone) => {
  const safePhone = String(phone || '').trim();
  if (!safePhone) throw new Error('Phone is required.');
  return requestJson('/messages/history/request-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: safePhone }) }, 'Failed to request sync');
};
export const getContacts = async () => requestJson('/contacts', {}, 'Failed to fetch contacts');
export const addContact = async (payload) => requestJson('/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Failed to add contact');
export const deleteContact = async (id) => requestJson(`/contacts/${id}`, { method: 'DELETE' }, 'Failed to delete contact');
export const importContactsXlsx = async (file) => {
  const fd = new FormData(); fd.append('file', file);
  return requestJson('/contacts/import', { method: 'POST', body: fd }, 'Failed to import contacts');
};
export const fetchBotStatus = async () => requestJson('/bot/status', {}, 'Failed to fetch bot status');
