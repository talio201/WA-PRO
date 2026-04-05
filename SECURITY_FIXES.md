# 🔐 Guia de Correção de Vulnerabilidades de Segurança

**Objetivo:** Implementar soluções de mitigação para os riscos identificados

---

## 1. Remover Logging de Dados Sensíveis

### ❌ INSEGURO (Atual)

**`backend/src/utils/auth.js:145-155`**
```javascript
console.log('[DEBUG authenticateBearerToken]', {
  email,  // ❌ EMAIL SENSÍVEL
  isAdminEmail: email && isAdminEmail(email),
  userHasAdminFlag: userHasAdminFlag(user),
  saasAccessAllowAdmin: saasAccess?.allowAdmin,
  resultIsAdmin: isAdmin,
  saasUserMetadata: saasUser?.metadata,  // Pode conter dados sensíveis
});
```

**`backend/src/middleware/authMiddleware.js:80`**
```javascript
console.log('[AUTH MIDDLEWARE] authenticateBearerToken returned null for token:', 
  token.substring(0, 10) + '...', agentId);  // ❌ Primeiros 10 chars do token!
```

### ✅ SEGURO (Corrigido)

**Criar utilidade de logging seguro:**

```javascript
// backend/src/utils/secureLogs.js
const crypto = require('crypto');

const SENSITIVE_KEYS = [
  'email', 'password', 'token', 'secret', 'key', 'apikey',
  'authorization', 'credentials', 'bootstrap', 'apiKey',
  'authToken', 'sessionToken', 'refreshToken'
];

function maskSensitiveData(obj, depth = 0) {
  if (depth > 5) return '[DEEP_RECURSION]';  // Prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  
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
          masked[key] = value.length > 4 
            ? `${value.substring(0, 2)}***${value.substring(value.length - 2)}`
            : '***';
        } else {
          masked[key] = '[REDACTED]';
        }
      } else {
        masked[key] = maskSensitiveData(value, depth + 1);
      }
    }
    return masked;
  }
  
  return obj;
}

function hashToken(token) {
  if (!token) return '[EMPTY]';
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 8);
}

function secureLog(level, message, data = {}) {
  const masked = maskSensitiveData(data);
  console[level](`[${new Date().toISOString()}] ${message}`, masked);
}

module.exports = { maskSensitiveData, hashToken, secureLog };
```

**Usar em auth.js:**
```javascript
const { secureLog, hashToken } = require('../utils/secureLogs');

async function authenticateBearerToken(token, agentId = '') {
  const safeToken = String(token || '').trim();
  
  if (!safeToken) {
    secureLog('log', '[authenticateBearerToken] No token provided');
    return null;
  }

  // ... validation logic

  if (authResult?.kind === 'supabase-user') {
    secureLog('log', '[authenticateBearerToken] Supabase user authenticated', {
      tokenHash: hashToken(token),
      agentId: authResult.agentId,
      isAdmin: authResult.isAdmin,
      // NÃO logar: email, user, saasUser
    });
    return authResult;
  }

  return null;
}
```

---

## 2. Encriptar Admin-Settings.json

### ❌ INSEGURO (Atual)
```bash
# Arquivo em texto plano, qualquer um pode ler:
$ cat backend/data/admin-settings.json
{
  "clients": [{"apiKey": "abc123def456..."}],
  "installations": [{"installationSecret": "secret123..."}]
}
```

### ✅ SEGURO (Encriptado)

**`backend/src/config/encryptedStore.js`**

```javascript
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/admin-settings.enc');
const KEY_PATH = path.join(__dirname, '../../data/.store-key');

// Gerar chave de encriptação
function ensureEncryptionKey() {
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH);
  }
  
  // Usar variável de ambiente se disponível
  const envKey = process.env.STORE_ENCRYPTION_KEY;
  if (envKey) {
    const keyBuffer = Buffer.from(envKey, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('STORE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    }
    return keyBuffer;
  }
  
  // Gerar nova chave
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key);
  fs.chmodSync(KEY_PATH, 0o600);  // Apenas owner pode ler
  return key;
}

function encryptData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const jsonString = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(jsonString, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
    version: 1
  };
}

function decryptData(encryptedObj, key) {
  if (!encryptedObj.iv || !encryptedObj.data || !encryptedObj.authTag) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));
  
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedObj.data, 'hex')),
    decipher.final()
  ]);
  
  return JSON.parse(decrypted.toString('utf8'));
}

function readStore() {
  const key = ensureEncryptionKey();
  
  if (!fs.existsSync(STORE_PATH)) {
    return DEFAULT_STORE;  // Retornar vazio na primeira execução
  }
  
  try {
    const encrypted = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return decryptData(encrypted, key);
  } catch (e) {
    console.error('[!] Failed to decrypt store:', e.message);
    process.exit(1);
  }
}

function writeStore(store) {
  const key = ensureEncryptionKey();
  const encrypted = encryptData(store, key);
  
  // Escrever com permissões restritas
  fs.writeFileSync(STORE_PATH, JSON.stringify(encrypted), { mode: 0o600 });
}

module.exports = { readStore, writeStore, encryptData, decryptData };
```

**Usar em lugar de adminStore.js:**

```javascript
// backend/src/config/adminStore.js (modificado)
const { readStore: readEncryptedStore, writeStore: writeEncryptedStore } = require('./encryptedStore');

function readStore() {
  try {
    return readEncryptedStore();
  } catch (e) {
    console.error('Failed to read encrypted store');
    return DEFAULT_STORE;
  }
}

function writeStore(store) {
  try {
    writeEncryptedStore(store);
  } catch (e) {
    console.error('Failed to write encrypted store');
    throw e;
  }
}
```

**Setup em produção:**
```bash
# Gerar chave
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Configurar no environment
export STORE_ENCRYPTION_KEY=abc123def456...
```

---

## 3. Validação de API_SECRET_KEY com Startup Check

**`backend/src/server.js` (início do arquivo)**

```javascript
require('dotenv').config();

// ✅ Validar secrets ANTES de iniciar
function validateSecrets() {
  const secrets = [
    { name: 'API_SECRET_KEY', minLength: 32 },
    { name: 'SUPABASE_URL', minLength: 10 },
    { name: 'SUPABASE_ANON_KEY', minLength: 20 },
  ];

  for (const secret of secrets) {
    const value = String(process.env[secret.name] || '').trim();
    
    if (!value) {
      console.error(`\n❌ CRITICAL: ${secret.name} is not defined`);
      console.error(`   Set: export ${secret.name}=value`);
      process.exit(1);
    }
    
    if (value.length < secret.minLength) {
      console.error(
        `\n❌ WARNING: ${secret.name} is too short (${value.length} chars, need ${secret.minLength}+)`
      );
      console.error('   Consider using a stronger secret');
    }
  }

  console.log('✅ All required secrets are configured');
}

// Chamar no início
validateSecrets();
```

---

## 4. CORS Configuração Segura

**`backend/src/server.js`**

```javascript
const cors = require('cors');

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://tcgsolucoes.app').split(',');
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requisições sem origin (mobile, desktop apps)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-ID'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 3600,
  optionsSuccessStatus: 200
}));
```

---

## 5. Rate Limiting Global

**`backend/src/middleware/rateLimitMiddleware.js`**

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');

const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

// Limiter geral: 100 requisições por 15 minutos
const globalLimiter = rateLimit({
  store: new RedisStore({
    client,
    prefix: 'rl:global:',
  }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter para login: 5 tentativas por 15 minutos
const loginLimiter = rateLimit({
  store: new RedisStore({
    client,
    prefix: 'rl:login:',
  }),
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,  // Não conta tentativas com sucesso
  message: 'Too many login attempts, please try again later',
});

// Limiter para bootstrap: 3 tentativas por hora
const bootstrapLimiter = rateLimit({
  store: new RedisStore({
    client,
    prefix: 'rl:bootstrap:',
  }),
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many bootstrap attempts',
});

module.exports = { globalLimiter, loginLimiter, bootstrapLimiter };
```

**Usar em routes:**
```javascript
const { globalLimiter, loginLimiter, bootstrapLimiter } = require('../middleware/rateLimitMiddleware');

app.use(globalLimiter);  // Aplica a todas

app.post('/api/auth/login', loginLimiter, authController.login);
app.post('/api/public/admin/bootstrap', bootstrapLimiter, activationController.bootstrapAdminAccess);
```

---

## 6. Validação Robusta de Email

**`backend/src/utils/validators.js`**

```javascript
const emailRegex = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const domainBlacklist = ['example.com', 'test.com', 'tempmail.com'];

function validateEmail(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  const [user, domain] = trimmed.split('@');
  
  // Verificar blacklist de domínios
  if (domainBlacklist.includes(domain)) {
    return { valid: false, error: 'Domain not allowed' };
  }
  
  // Verificar padrões descartáveis
  if (user.length < 2 || /^[0-9]+$/.test(user)) {
    return { valid: false, error: 'Invalid email user part' };
  }
  
  return { valid: true, email: trimmed };
}

function sanitizeEmail(email) {
  const result = validateEmail(email);
  if (!result.valid) throw new Error(result.error);
  return result.email;
}

module.exports = { validateEmail, sanitizeEmail };
```

**Usar em controllers:**
```javascript
const { sanitizeEmail } = require('../utils/validators');

exports.signup = async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    // Proceder com email validado
  } catch (error) {
    return res.status(400).json({ msg: error.message });
  }
};
```

---

## 7. Bootstrap Sempre com Secret

**`backend/src/controllers/publicActivationController.js`**

```javascript
exports.bootstrapAdminAccess = async (req, res) => {
  try {
    const bootstrapSecret = safeString(req.body?.bootstrapSecret);
    const configuredSecret = getBootstrapSecret();
    
    // ✅ SEMPRE exigir secret configurado
    if (!configuredSecret || configuredSecret.length < 16) {
      console.error('[SECURITY] Bootstrap secret not configured or too weak');
      return res.status(503).json({
        msg: 'Admin bootstrap is not available. Contact system administrator.'
      });
    }

    // ✅ Verificar secret
    if (!bootstrapSecret || bootstrapSecret.length < 1) {
      return res.status(400).json({
        msg: 'Bootstrap secret is required.'
      });
    }

    if (bootstrapSecret !== configuredSecret) {
      // Usar timing-safe comparison
      const crypto = require('crypto');
      const userHash = crypto.createHash('sha256').update(bootstrapSecret).digest();
      const configHash = crypto.createHash('sha256').update(configuredSecret).digest();
      
      if (!userHash.equals(configHash)) {
        return res.status(403).json({
          msg: 'Invalid bootstrap secret.'
        });
      }
    }

    // ✅ Verificar allowlist
    if (!isAuthorizedBootstrapUser(req.user)) {
      return res.status(403).json({
        msg: 'Your account is not authorized to bootstrap admin access.'
      });
    }

    // Proceder com bootstrap...
    secureLog('info', '[bootstrap] Admin access enabled', {
      email: req.user.email,
      timestamp: new Date().toISOString()
    });

    return res.json({ success: true, msg: 'Admin access enabled' });

  } catch (error) {
    console.error('[ERROR bootstrapAdminAccess]', error.message);
    return res.status(500).json({ msg: 'Failed to bootstrap admin access.' });
  }
};
```

---

## 8. HTTP-Only Cookies para Sessão

**`backend/src/utils/auth.js`**

```javascript
function setSecureSessionCookie(res, token) {
  res.cookie('session_token', token, {
    httpOnly: true,  // ✅ Não acessível via JavaScript
    secure: process.env.NODE_ENV === 'production',  // HTTPS only em prod
    sameSite: 'Strict',  // ✅ Previne CSRF
    maxAge: 3600 * 1000,  // 1 hora
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined
  });
}

function getSessionFromCookie(req) {
  return req.cookies?.session_token;
}

module.exports = { setSecureSessionCookie, getSessionFromCookie };
```

---

## ✅ Checklist de Implementação

- [ ] Criar `backend/src/utils/secureLogs.js`
- [ ] Implementar masking em todos os logs sensíveis
- [ ] Criar `backend/src/config/encryptedStore.js`
- [ ] Adicionar validação de secrets no startup
- [ ] Configurar CORS com whitelist
- [ ] Implementar rate limiting com Redis/Memory
- [ ] Adicionar validação robusta de emails
- [ ] Garantir bootstrap sempre com secret
- [ ] Usar HTTP-only cookies para sessão
- [ ] Testar todas as validações

---

## 🔍 Como Testar as Correções

```bash
# Testar logging seguro
node -e "
const { secureLog, hashToken } = require('./backend/src/utils/secureLogs');
secureLog('log', 'Test', { 
  email: 'user@example.com',
  apiKey: 'secret123456'
});
"

# Testar encriptação
node backend/src/config/encryptedStore.js

# Validação de startup
API_SECRET_KEY=test node backend/src/server.js
# Deve faltar: precisa de 32+ chars

# Rate limiting
for i in {1..10}; do 
  curl -X POST http://localhost:3000/api/auth/login
done
# Após 5: 429 Too Many Requests
```

---

**Status:** Pronto para implementação  
**Tempo estimado:** 2-3 dias  
**Equipes envolvidas:** Backend, DevOps, Security  

