/**
 * Secure Logging Utility
 * 
 * Automatically masks sensitive data in logs to prevent credential exposure
 * in stdout, log files, and monitoring systems (Sentry, DataDog, etc)
 */

const crypto = require('crypto');

const SENSITIVE_KEYS = [
  'email', 'password', 'token', 'secret', 'key', 'apikey',
  'authorization', 'credentials', 'bootstrap', 'apiKey',
  'authToken', 'sessionToken', 'refreshToken', 'accessToken',
  'privateKey', 'secrets', 'supabaseKey', 'installationSecret',
  'bootstrapSecret', 'apiSecret'
];

/**
 * Recursively mask sensitive data in objects
 * @param {*} obj - Object to mask
 * @param {number} depth - Current recursion depth (prevent infinite loops)
 * @returns {*} Masked object
 */
function maskSensitiveData(obj, depth = 0) {
  if (depth > 5) return '[DEEP_RECURSION]';  // Prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'boolean') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item, depth + 1));
  }
  
  if (typeof obj === 'object') {
    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = String(key).toLowerCase();
      const isSensitive = SENSITIVE_KEYS.some(k => lowerKey.includes(k));
      
      if (isSensitive) {
        if (typeof value === 'string') {
          if (value.length === 0) {
            masked[key] = '';
          } else if (value.length <= 4) {
            masked[key] = '***';
          } else {
            masked[key] = `${value.substring(0, 2)}***${value.substring(value.length - 2)}`;
          }
        } else if (typeof value === 'number') {
          masked[key] = '***';
        } else if (value === null) {
          masked[key] = null;
        } else {
          masked[key] = '[REDACTED]';
        }
      } else if (typeof value === 'object') {
        masked[key] = maskSensitiveData(value, depth + 1);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
  
  return obj;
}

/**
 * Generate a hash for a token (for correlation without exposing the token)
 * @param {string} token - Token to hash
 * @returns {string} First 8 chars of SHA-256 hash
 */
function hashToken(token) {
  if (!token) return '[EMPTY]';
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  return hash.substring(0, 8);
}

/**
 * Generate a hash for an email (for correlation without exposing the email)
 * @param {string} email - Email to hash
 * @returns {string} First 8 chars of SHA-256 hash
 */
function hashEmail(email) {
  if (!email) return '[EMPTY]';
  const hash = crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex');
  return hash.substring(0, 8);
}

/**
 * Safe log with automatic masking of sensitive data
 * @param {string} level - Log level ('log', 'info', 'warn', 'error')
 * @param {string} message - Log message
 * @param {object} data - Additional data to log (will be masked)
 */
function secureLog(level, message, data = {}) {
  const masked = maskSensitiveData(data);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  if (console[level]) {
    console[level](logMessage, masked);
  } else {
    console.log(logMessage, masked);
  }
}

/**
 * Log authentication attempt (with masking)
 * @param {string} purpose - Purpose of log (login, bootstrap, etc)
 * @param {object} details - Details to log
 */
function logAuthAttempt(purpose, details = {}) {
  secureLog('info', `[AUTH] ${purpose}`, {
    ...details,
    // Explicitly mask certain fields even if not detected
    email: details.email ? `[masked-${hashEmail(details.email)}]` : undefined,
    token: details.token ? `[masked-${hashToken(details.token)}]` : undefined,
    password: details.password ? '[REDACTED]' : undefined,
  });
}

/**
 * Log security event (breach attempts, etc)
 * @param {string} event - Event type
 * @param {object} details - Event details
 */
function logSecurityEvent(event, details = {}) {
  const level = event.includes('failed') || event.includes('denied') ? 'warn' : 'error';
  secureLog(level, `[SECURITY] ${event}`, {
    timestamp: new Date().toISOString(),
    ...maskSensitiveData(details),
  });
}

module.exports = {
  maskSensitiveData,
  hashToken,
  hashEmail,
  secureLog,
  logAuthAttempt,
  logSecurityEvent,
  SENSITIVE_KEYS,
};
