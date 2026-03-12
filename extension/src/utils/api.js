import { getAuthorizedHeaders, getRuntimeConfig } from './runtimeConfig';

const parseResponsePayload = async (response) => {
  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text ? { msg: text } : {};
};
const requestJson = async (
  path,
  options = {},
  fallbackMessage = "Request failed",
) => {
  const { backendApiUrl, backendApiKey } = await getRuntimeConfig();
  if (!backendApiKey) {
    throw new Error("API key not configured in extension settings.");
  }
  const mergedHeaders = await getAuthorizedHeaders(options.headers || {});
  const mergedOptions = {
    ...options,
    headers: mergedHeaders,
  };
  const url = `${backendApiUrl}${String(path || "")}`;
  const response = await fetch(url, mergedOptions);
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const message = payload?.msg || payload?.message || fallbackMessage;
    throw new Error(message);
  }
  return payload;
};
export const getCampaigns = async () => {
  try {
    return await requestJson(
      `/campaigns`,
      {},
      "Failed to fetch campaigns",
    );
  } catch (error) {
    console.error("API Error:", error);
    return [];
  }
};
export const getMessages = async (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(
    `/messages${suffix}`,
    {},
    "Failed to fetch messages",
  );
};
export const getConversations = async (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(
    `/messages/conversations${suffix}`,
    {},
    "Failed to fetch conversations",
  );
};
export const getConversationHistory = async (phone, params = {}) => {
  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    throw new Error("Phone is required.");
  }
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(
    `/messages/conversations/${encodeURIComponent(safePhone)}/history${suffix}`,
    {},
    "Failed to fetch conversation history",
  );
};
export const syncConversationHistory = async (phone, payload = {}) => {
  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    throw new Error("Phone is required.");
  }
  return requestJson(
    `/messages/conversations/${encodeURIComponent(safePhone)}/history/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    },
    "Failed to sync conversation history",
  );
};
export const createCampaign = async (data) =>
  requestJson(
    `/campaigns`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    "Failed to create campaign",
  );
export const uploadFile = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson(
    `/upload`,
    {
      method: "POST",
      body: formData,
    },
    "Failed to upload file",
  );
};
export const deleteCampaign = async (campaignId) =>
  requestJson(
    `/campaigns/${campaignId}`,
    {
      method: "DELETE",
    },
    "Failed to delete campaign",
  );
export const getCampaignFailures = async (campaignId) =>
  requestJson(
    `/campaigns/${campaignId}/failures`,
    {},
    "Failed to fetch campaign failures",
  );
export const getMessageAudit = async (messageId) =>
  requestJson(
    `/messages/${messageId}/audit`,
    {},
    "Failed to fetch message audit",
  );
export const updateMessage = async (messageId, payload) =>
  requestJson(
    `/messages/${messageId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to update message",
  );
export const retryMessage = async (messageId, payload = {}) =>
  requestJson(
    `/messages/${messageId}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to retry message",
  );
export const assignConversation = async (phone, payload) =>
  requestJson(
    `/messages/conversations/${encodeURIComponent(phone)}/assign`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    },
    "Failed to assign conversation",
  );
export const releaseConversation = async (phone, payload = {}) =>
  requestJson(
    `/messages/conversations/${encodeURIComponent(phone)}/release`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    },
    "Failed to release conversation",
  );
export const registerInboundMessage = async (payload = {}) =>
  requestJson(
    `/messages/inbound`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to register inbound message",
  );
export const registerManualOutbound = async (payload = {}) =>
  requestJson(
    `/messages/outbound/manual`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to register manual outbound message",
  );
export const generateMessageVariants = async ({ message, count = 5 }) =>
  requestJson(
    `/ai/generate-variants`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, count }),
    },
    "Failed to generate message variants",
  );
export const requestConversationHistorySync = async (phone) => {
  const safePhone = String(phone || "").trim();
  if (!safePhone) throw new Error("Phone is required.");
  return requestJson(
    `/messages/history/request-sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: safePhone }),
    },
    "Failed to request conversation history sync",
  );
};

// API DE CONTATOS (AGENT ISOLATED)
export const getContacts = async () => {
  return requestJson(`/contacts`, {}, "Failed to fetch contacts");
};

export const addContact = async (payload) => {
  return requestJson(`/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Failed to add contact");
};

export const deleteContact = async (id) => {
  return requestJson(`/contacts/${id}`, {
    method: "DELETE"
  }, "Failed to delete contact");
};

export const importContactsXlsx = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson(`/contacts/import`, {
    method: "POST",
    body: formData
  }, "Failed to import contacts");
};

export const fetchBotStatus = async () => {
  return requestJson(`/bot/status`, {}, "Failed to fetch bot status");
};
