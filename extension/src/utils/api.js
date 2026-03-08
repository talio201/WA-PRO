const API_URL = 'http://localhost:3000/api';

const parseResponsePayload = async (response) => {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    return text ? { msg: text } : {};
};

const requestJson = async (url, options = {}, fallbackMessage = 'Request failed') => {
    const response = await fetch(url, options);
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
        const message = payload?.msg || payload?.message || fallbackMessage;
        throw new Error(message);
    }

    return payload;
};

export const getCampaigns = async () => {
    try {
        return await requestJson(`${API_URL}/campaigns`, {}, 'Failed to fetch campaigns');
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};

export const getMessages = async (params = {}) => {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            query.set(key, String(value));
        }
    });

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`${API_URL}/messages${suffix}`, {}, 'Failed to fetch messages');
};

export const getConversations = async (params = {}) => {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            query.set(key, String(value));
        }
    });

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`${API_URL}/messages/conversations${suffix}`, {}, 'Failed to fetch conversations');
};

export const getConversationHistory = async (phone, params = {}) => {
    const safePhone = String(phone || '').trim();
    if (!safePhone) {
        throw new Error('Phone is required.');
    }

    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            query.set(key, String(value));
        }
    });

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(
        `${API_URL}/messages/conversations/${encodeURIComponent(safePhone)}/history${suffix}`,
        {},
        'Failed to fetch conversation history'
    );
};

export const syncConversationHistory = async (phone, payload = {}) => {
    const safePhone = String(phone || '').trim();
    if (!safePhone) {
        throw new Error('Phone is required.');
    }

    return requestJson(
        `${API_URL}/messages/conversations/${encodeURIComponent(safePhone)}/history/sync`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        },
        'Failed to sync conversation history'
    );
};

export const createCampaign = async (data) => requestJson(
    `${API_URL}/campaigns`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    },
    'Failed to create campaign'
);

export const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    return requestJson(
        `${API_URL}/upload`,
        {
            method: 'POST',
            body: formData,
        },
        'Failed to upload file'
    );
};

export const deleteCampaign = async (campaignId) => requestJson(
    `${API_URL}/campaigns/${campaignId}`,
    {
        method: 'DELETE',
    },
    'Failed to delete campaign'
);

export const getCampaignFailures = async (campaignId) => requestJson(
    `${API_URL}/campaigns/${campaignId}/failures`,
    {},
    'Failed to fetch campaign failures'
);

export const getMessageAudit = async (messageId) => requestJson(
    `${API_URL}/messages/${messageId}/audit`,
    {},
    'Failed to fetch message audit'
);

export const updateMessage = async (messageId, payload) => requestJson(
    `${API_URL}/messages/${messageId}`,
    {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    },
    'Failed to update message'
);

export const retryMessage = async (messageId, payload = {}) => requestJson(
    `${API_URL}/messages/${messageId}/retry`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    },
    'Failed to retry message'
);

export const assignConversation = async (phone, payload) => requestJson(
    `${API_URL}/messages/conversations/${encodeURIComponent(phone)}/assign`,
    {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    },
    'Failed to assign conversation'
);

export const releaseConversation = async (phone, payload = {}) => requestJson(
    `${API_URL}/messages/conversations/${encodeURIComponent(phone)}/release`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    },
    'Failed to release conversation'
);

export const registerInboundMessage = async (payload = {}) => requestJson(
    `${API_URL}/messages/inbound`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    },
    'Failed to register inbound message'
);

export const registerManualOutbound = async (payload = {}) => requestJson(
    `${API_URL}/messages/outbound/manual`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    },
    'Failed to register manual outbound message'
);

export const generateMessageVariants = async ({ message, count = 5 }) => requestJson(
    `${API_URL}/ai/generate-variants`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, count }),
    },
    'Failed to generate message variants'
);
