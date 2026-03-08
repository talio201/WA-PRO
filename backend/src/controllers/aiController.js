const { gemini } = require('../config/config');
const { emitRealtimeEvent } = require('../realtime/realtime');

function normalizeModelName(modelName = '') {
    const safe = String(modelName || '').trim();
    if (!safe) return '';
    return safe.startsWith('models/') ? safe : `models/${safe}`;
}

function extractTextFromGeminiPayload(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) return '';

    return parts
        .map((part) => String(part?.text || ''))
        .join('\n')
        .trim();
}

function parseMessageVariants(rawText = '', targetCount = 5) {
    const text = String(rawText || '').trim();
    if (!text) return [];

    const result = [];
    const seen = new Set();

    const addVariant = (value) => {
        const clean = String(value || '').trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        result.push(clean);
    };

    const tryParseJsonArray = (candidate) => {
        try {
            const parsed = JSON.parse(candidate);
            if (!Array.isArray(parsed)) return false;
            parsed.forEach((item) => addVariant(item));
            return true;
        } catch (error) {
            return false;
        }
    };

    if (!tryParseJsonArray(text)) {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
            tryParseJsonArray(text.slice(start, end + 1));
        }
    }

    if (result.length === 0) {
        text.split('\n').forEach((line) => {
            const clean = line
                .replace(/^\s*[-*]\s*/, '')
                .replace(/^\s*\d+[\).\-\:]\s*/, '')
                .trim();
            addVariant(clean);
        });
    }

    return result.slice(0, Math.max(1, targetCount));
}

function buildPrompt(baseMessage = '', targetCount = 5) {
    const count = Math.max(1, Number(targetCount) || 5);

    return [
        `Gere EXATAMENTE ${count} variacoes de mensagem para WhatsApp.`,
        'Regras:',
        '- Manter o mesmo contexto da mensagem base.',
        '- Preservar o placeholder {name} quando fizer sentido.',
        '- Variar abertura, chamada e fechamento.',
        '- Nao usar markdown.',
        `- Responder apenas com um JSON array de ${count} strings.`,
        '',
        `Mensagem base: """${String(baseMessage || '').trim()}"""`,
    ].join('\n');
}

function orderModels(availableModels = []) {
    const normalizedAvailable = availableModels
        .map((item) => normalizeModelName(item))
        .filter(Boolean);

    const preferred = (gemini.preferredModels || [])
        .map((item) => normalizeModelName(item))
        .filter(Boolean);

    const ordered = [];
    const seen = new Set();

    preferred.forEach((model) => {
        if (normalizedAvailable.includes(model) && !seen.has(model)) {
            seen.add(model);
            ordered.push(model);
        }
    });

    normalizedAvailable.forEach((model) => {
        if (!seen.has(model)) {
            seen.add(model);
            ordered.push(model);
        }
    });

    return ordered;
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(gemini.requestTimeoutMs) || 20000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function listGenerateContentModels(apiKey) {
    const endpoint = `${gemini.apiBaseUrl}/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetchWithTimeout(endpoint);

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Model listing failed (${response.status}): ${body}`);
    }

    const payload = await response.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];

    return models
        .filter((model) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
        .map((model) => model.name)
        .filter(Boolean);
}

async function tryGenerateWithModel(apiKey, modelName, promptText) {
    const endpoint = `${gemini.apiBaseUrl}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [{ text: promptText }],
                },
            ],
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Generate failed (${response.status}): ${body}`);
    }

    const payload = await response.json();
    const text = extractTextFromGeminiPayload(payload);

    return { payload, text };
}

// @desc    Generate message variants with Gemini using server-side key
// @route   POST /api/ai/generate-variants
exports.generateVariants = async (req, res) => {
    try {
        const apiKey = String(gemini.apiKey || '').trim();
        const baseMessage = String(req.body?.message || '').trim();
        const targetCount = Math.max(1, Math.min(Number(req.body?.count) || 5, 10));

        if (!apiKey) {
            return res.status(400).json({
                msg: 'Gemini API key is not configured on server. Set GEMINI_API_KEY in backend/.env.',
            });
        }

        if (!baseMessage) {
            return res.status(400).json({ msg: 'Message is required.' });
        }

        emitRealtimeEvent('ai.variants.requested', {
            targetCount,
            messageLength: baseMessage.length,
        });

        const availableModels = await listGenerateContentModels(apiKey);
        const modelsToTry = orderModels(availableModels);

        if (modelsToTry.length === 0) {
            emitRealtimeEvent('ai.variants.unavailable', {
                reason: 'no_generate_content_models',
            });
            return res.status(502).json({ msg: 'No Gemini model with generateContent support available for this key.' });
        }

        const prompt = buildPrompt(baseMessage, targetCount);
        const attempts = [];

        for (const model of modelsToTry) {
            try {
                const { text } = await tryGenerateWithModel(apiKey, model, prompt);
                const variants = parseMessageVariants(text, targetCount);

                if (variants.length >= targetCount) {
                    emitRealtimeEvent('ai.variants.generated', {
                        model,
                        targetCount,
                        count: variants.length,
                    });
                    return res.json({
                        model,
                        variants,
                        attemptedModels: attempts.map((item) => item.model),
                    });
                }

                attempts.push({ model, error: `Insufficient variants (${variants.length})` });
            } catch (error) {
                attempts.push({
                    model,
                    error: error.message,
                });
            }
        }

        emitRealtimeEvent('ai.variants.failed', {
            targetCount,
            attemptedModels: attempts.map((item) => item.model),
        });
        return res.status(502).json({
            msg: 'Could not generate variants with available Gemini models.',
            attemptedModels: attempts,
        });
    } catch (error) {
        console.error('AI generateVariants error:', error.message);
        emitRealtimeEvent('ai.variants.error', {
            message: String(error.message || 'unknown_error'),
        });
        res.status(500).json({ msg: 'Server error while generating variants.' });
    }
};
