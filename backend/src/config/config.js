const GEMINI_DEFAULT_MODELS = [
    'models/gemini-2.0-flash',
    'models/gemini-1.5-flash',
    'models/gemini-1.5-pro',
];

function resolveStorageProvider() {
    return String(
        process.env.STORAGE_PROVIDER
        || process.env.DB_PROVIDER
        || (process.env.SUPABASE_ENABLED === 'true' ? 'supabase' : 'local')
    )
        .trim()
        .toLowerCase();
}

module.exports = {
    gemini: {
        // Use GEMINI_API_KEY no arquivo .env.
        apiKey: String(process.env.GEMINI_API_KEY || '').trim(),
        apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        preferredModels: GEMINI_DEFAULT_MODELS,
        requestTimeoutMs: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 20000,
    },
    supabase: {
        enabled: resolveStorageProvider() === 'supabase' || process.env.SUPABASE_ENABLED === 'true',
        url: String(process.env.SUPABASE_URL || '').trim(),
        anonKey: String(process.env.SUPABASE_ANON_KEY || '').trim(),
        serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    },
    storage: {
        provider: resolveStorageProvider(),
    },
};
