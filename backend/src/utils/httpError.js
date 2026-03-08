function normalizeErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.message) return String(error.message);
    return String(error);
}

function classifyStorageError(rawMessage) {
    const message = String(rawMessage || '').toLowerCase();

    if (message.includes('permission denied')) {
        return {
            statusCode: 500,
            code: 'SUPABASE_PERMISSION_DENIED',
            message: 'Supabase permission denied. Configure SUPABASE_SERVICE_ROLE_KEY in backend/.env.',
        };
    }

    if (message.includes('could not find the table')) {
        return {
            statusCode: 500,
            code: 'SUPABASE_TABLE_NOT_FOUND',
            message: 'Supabase table not found. Execute backend/supabase/schema.sql or backend/supabase/add_conversation_assignments.sql in Supabase SQL Editor.',
        };
    }

    if (message.includes('invalid api key')) {
        return {
            statusCode: 500,
            code: 'SUPABASE_INVALID_KEY',
            message: 'Invalid Supabase key. Verify SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in backend/.env.',
        };
    }

    return null;
}

function buildServerErrorResponse(error, fallbackMessage = 'Server Error') {
    const rawMessage = normalizeErrorMessage(error);
    const storageError = classifyStorageError(rawMessage);

    if (storageError) {
        return {
            statusCode: storageError.statusCode,
            body: {
                msg: storageError.message,
                code: storageError.code,
                details: rawMessage,
            },
        };
    }

    return {
        statusCode: 500,
        body: {
            msg: fallbackMessage,
            details: rawMessage || fallbackMessage,
        },
    };
}

module.exports = {
    buildServerErrorResponse,
};
