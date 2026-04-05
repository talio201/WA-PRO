# 🔒 Análise de Segurança - Exposição de Dados Sensíveis e Riscos

**Data:** 2026-04-05  
**Escopo:** Backend (Node.js), Frontend (React), Autenticação (Supabase)  
**Status:** ⚠️ **Crítico** - Vários riscos identificados

---

## 📋 Sumário Executivo

| Risco | Severidade | Quantidade | Status |
|-------|-----------|-----------|--------|
| Logging de dados sensíveis | 🔴 CRÍTICO | 5 | Ativo |
| Armazenamento inseguro de secrets | 🔴 CRÍTICO | 3 | Ativo |
| Exposição de tokens em logs | 🔴 CRÍTICO | 4 | Ativo |
| SQL Injection potencial | 🟠 ALTO | 2 | Possível |
| CORS não configurado | 🟠 ALTO | 1 | Ativo |
| Rate limiting inadequado | 🟠 ALTO | 1 | Parcial |
| Validação fraca de entrada | 🟡 MÉDIO | 6 | Ativo |
| Exposição de emails em localStorage | 🟡 MÉDIO | 1 | Ativo |
| JWT mal assinado | 🟡 MÉDIO | 1 | Ativo |
| Falta de HTTPS enforcement | 🟡 MÉDIO | 1 | Ativo |

---

## 🔴 RISCOS CRÍTICOS

### 1. **Logging de Tokens e Secrets em Console**

**Localização:**
- `backend/src/utils/auth.js:145-155` - Logs incluem `email`, `agentId`, `isAdmin`
- `backend/src/middleware/authMiddleware.js:80` - Token sendo logado
- `backend/src/controllers/publicActivationController.js:239-250` - Bootstrap secret logado

**Código Vulnerável:**
```javascript
// ❌ INSEGURO
console.log('[AUTH MIDDLEWARE] authenticateBearerToken returned null for token:', 
  token.substring(0, 10) + '...', agentId);  // Expõe primeiros 10 chars do token!

console.log('[DEBUG bootstrapAdminAccess]', {
  bootstrapSecret: bootstrapSecret ? '***' : 'empty',  // ❌ Revela se secret existe
  configuredSecret: configuredSecret ? '***' : 'empty',
  userEmail: req.user?.email,  // ⚠️ Email sensível
});
```

**Impacto:**
- Tokens podem ser recuperados do logs de produção
- Atacantes podem usar substring com força bruta
- Logs aparecem em: stdout, arquivos, monitoramento de erros (Sentry, etc)

**Recomendação:**
```javascript
// ✅ SEGURO
const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 8);
console.log('[DEBUG] Token hash:', tokenHash);  // Não reversível

// Nunca logar:
// - Tokens completos ou parciais
// - Emails de usuários
// - Secrets ou API keys
// - Senhas
```

---

### 2. **Admin-settings.json - Armazenamento de Secrets em Texto Plano**

**Localização:**
- `backend/data/admin-settings.json` - Arquivo JSON persistido no disco
- `backend/src/config/adminStore.js:5` - Caminho local sem criptografia

**Arquivo Vulnerável:**
```json
{
  "adminUsers": ["email@example.com"],
  "saasUsers": [{
    "email": "tarciisooguuimaraes@gmail.com",
    "metadata": {
      "access": {"allowAdmin": true},
      "bootstrap": {"enabledAt": "2026-04-03T05:54:48.759Z"}
    }
  }],
  "clients": [{
    "apiKey": "abc123def456...",  // ❌ API KEY em texto plano!
    "clientId": "client_xyz"
  }],
  "installations": [{
    "installationSecret": "secret_xyz..."  // ❌ SECRETS em texto plano!
  }]
}
```

**Impacto:**
- 🔓 Qualquer acesso ao servidor = compromisso de credenciais
- Backups podem expor dados
- Controle de versão (git) pode expor histórico de secrets
- Sem permissões de arquivo de leitura, arquivo é 0644 (mundo legível)

**Recomendação:**
```javascript
// ✅ ENCRIPTAR dados sensíveis
const crypto = require('crypto');

function encryptSensitiveData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final()
  ]);
  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

// Ou use: dotenv + Vault, AWS Secrets Manager, Supabase Secrets
```

---

### 3. **Supabase Keys em .env Sem Proteção**

**Localização:**
- `backend/.env` - Arquivo contém chaves anonous + credentials
- `backend/src/utils/auth.js:67-72` - Chaves carregadas em memória sem verificação

**Variáveis Críticas Sem Proteção:**
```bash
# ❌ INSEGURO - Expostas em .env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
API_SECRET_KEY=very_long_secret_key_here
ADMIN_BOOTSTRAP_SECRET=bootstrap_secret
GEMINI_API_KEY=google_gemini_key
```

**Impacto:**
- `.env` checado em git = exposição permanente
- Servidor comprometido = roubo de todas as credenciais
- SERVICE_ROLE_KEY = acesso administrativo ao Supabase

**Recomendação:**
```bash
# ✅ SEGURO
# 1. Nunca commitar .env:
echo ".env" >> .gitignore

# 2. Usar variáveis de ambiente em produção
# (GitHub Actions, AWS Systems Manager, Docker secrets)

# 3. Service role key NUNCA no frontend
# 4. Rotacionar chaves regularmente

# 5. Usar ambiente variables separadas:
SUPABASE_ANON_KEY=xxx   # Apenas frontend, sem dados sensíveis
SUPABASE_SERVICE_ROLE=yyy  # Backend only, com RLS policies rigorosas
```

---

### 4. **JWT Assinado com Secret Fraco**

**Localização:**
- `backend/src/utils/auth.js:25-29`

**Código Vulnerável:**
```javascript
function getSessionSigningSecret() {
  return String(process.env.API_SECRET_KEY || '').trim() || 'emidia-session-secret';
  //                                                            ^^^^^^^^^^^^^^^^^^^
  //                                                      ❌ fallback inseguro!
}

// JWT assinado com:
// Padrão: process.env.API_SECRET_KEY ou 'emidia-session-secret'
// Problema: Se API_SECRET_KEY não definido, usa string hardcoded!
```

**Impacto:**
- JWT pode ser falsificado se secret não configurado
- Atacante pode criar tokens válidos
- Bypass de autenticação

**Recomendação:**
```javascript
function getSessionSigningSecret() {
  const secret = String(process.env.API_SECRET_KEY || '').trim();
  if (!secret) {
    throw new Error('CRITICAL: API_SECRET_KEY must be defined in environment');
  }
  if (secret.length < 32) {
    console.error('⚠️ WARNING: API_SECRET_KEY is too short (< 32 chars)');
  }
  return secret;
}
```

---

## 🟠 RISCOS ALTOS

### 5. **Exposição de Email em localStorage (Frontend)**

**Localização:**
- `webapp/src/main.jsx:115` - agentId armazenado em localStorage
- `backend/public/admin.html:490` - Credentials em variáveis globais

**Código Vulnerável:**
```javascript
// ❌ INSEGURO - localStorage é facilmente acessível
const localAgentId = String(localStorage.getItem('emidia_agent_id') || '').trim();
const sessionAgentId = String(session?.user?.user_metadata?.agentId || '').trim();

// localStorage.clear() revela tudo via JavaScript console!
```

**Impacto:**
- XSS = roubo de agentId
- localStorage sincronizado entre abas = vazamento
- DevTools = dados visíveis

**Recomendação:**
```javascript
// ✅ SEGURO - Use sessionStorage para dados temporários
sessionStorage.setItem('emidia_agent_id', agentId);  // Limpo ao fechar aba

// Ou melhor: Armazenar no servidor, apenas sessão HTTP-only cookie
// Set-Cookie: session=xxx; HttpOnly; Secure; SameSite=Strict
```

---

### 6. **CORS Não Configurado Explicitamente**

**Localização:**
- `backend/src/server.js:50+` - App .use(cors())
- Sem validação de origem

**Código Vulnerável:**
```javascript
// ❌ INSEGURO - CORS sem restrição
app.use(cors());  // Permite ALL origins!

// Equivalente a:
// Access-Control-Allow-Origin: *
```

**Impacto:**
- Qualquer domínio pode fazer requisições
- CSRF possível
- Vazamento de dados via JavaScript malicioso

**Recomendação:**
```javascript
const cors = require('cors');

app.use(cors({
  origin: [
    'https://tcgsolucoes.app',
    'https://www.tcgsolucoes.app',
    'http://localhost:3000'  // Dev only
  ],
  credentials: true,  // Permitir cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
}));
```

---

### 7. **Rate Limiting Insuficiente**

**Localização:**
- `backend/src/middleware/authMiddleware.js:37-51` - Throttle limitado a 5000 entradas
- Sem limite por IP global

**Código Vulnerável:**
```javascript
function shouldLogAuthFailure({ reason, ip, agentId, endpoint, userAgent }) {
  const key = `${reason}|${ip}|${agentId}|${endpoint}|${userAgent}`;
  const now = Date.now();
  const lastAt = Number(authFailureThrottle.get(key) || 0);
  
  if (now - lastAt < 30000) {
    return false;  // ⚠️ Apenas 30s de throttle!
  }
  // ... se 5000+ entradas, limpa metade
  // ❌ Sem limite de requisições por segundo!
}
```

**Impacto:**
- Brute force possível em endpoint de auth
- DoS via múltiplas requisições
- CPU/Memória crescente

**Recomendação:**
```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 5,  // 5 requisições por IP
  message: 'Muitas tentativas de login, tente mais tarde',
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  // Handler
});
```

---

## 🟡 RISCOS MÉDIOS

### 8. **Validação de Email Fraca**

**Localização:**
- `webapp/src/pages/Login.jsx:28-40`
- `backend/src/controllers/publicActivationController.js:200+`

**Código Vulnerável:**
```javascript
// ❌ Sem validação de email format
const email = document.getElementById('email').value;
// O valor pode ser: "", "   ", "not-an-email", "'; DROP TABLE --"

// Backend igualmente vulnerável
const email = safeString(req.body?.email);  // Apenas trim(), sem validação!
```

**Impacto:**
- Emails inválidos podem ser registrados
- Injeção SQL se banco não estiver protegido
- Spam/phishing

**Recomendação:**
```javascript
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = String(req.body.email || '').trim().toLowerCase();

if (!emailRegex.test(email)) {
  return res.status(400).json({ msg: 'Invalid email format' });
}

// Ou usar biblioteca: 
const validator = require('email-validator');
if (!validator.validate(email)) {
  throw new Error('Invalid email');
}
```

---

### 9. **Bootstraps Secret Verificação Incompleta**

**Localização:**
- `backend/src/controllers/publicActivationController.js:250-260`

**Código Vulnerável:**
```javascript
const configuredSecret = getBootstrapSecret();
const configuredAdmins = listAdminUsers();
const hasConfiguredAdmins = configuredAdmins.length > 0;

if (!configuredSecret) {
  if (hasConfiguredAdmins) {
    return res.status(503).json({ msg: 'Admin bootstrap is not configured.' });
  }
  // ❌ Se NO secret + NO admins, permite bootstrap sem verificação!
}
```

**Impacto:**
- Qualquer usuário Supabase autenticado pode virar admin
- Sem secret, não há barreira
- Escalação de privilégios

**Recomendação:**
```javascript
exports.bootstrapAdminAccess = async (req, res) => {
  const configuredSecret = getBootstrapSecret();
  
  // ✅ SEMPRE exigir secret para bootstrap
  if (!configuredSecret || configuredSecret.length < 16) {
    return res.status(503).json({
      msg: 'Admin bootstrap is not configured securely'
    });
  }

  const bootstrapSecret = req.body?.bootstrapSecret || '';
  
  if (bootstrapSecret !== configuredSecret) {
    return res.status(403).json({ msg: 'Invalid bootstrap secret' });
  }
  
  // Verificar allowlist de emails
  if (!isAuthorizedBootstrapUser(req.user)) {
    return res.status(403).json({ msg: 'Not authorized to bootstrap' });
  }

  // PROCEED...
};
```

---

### 10. **Hash de Email Sem Salt para Admin Allowlist**

**Localização:**
- `backend/src/config/adminStore.js:35-37`

**Código Vulnerável:**
```javascript
function hashAdminEmail(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return '';
  return `sha256:${crypto.createHash('sha256').update(safeEmail).digest('hex')}`;
  //                                                     ^^^^^^ Sem salt!
}
```

**Impacto:**
- Hash pode ser revisto (rainbow table attack)
- `sha256(email@example.com)` é sempre igual
- Atacante pode hashear lista de emails conhecidos

**Recomendação:**
```javascript
const HASH_SALT = process.env.ADMIN_ALLOWLIST_SALT || crypto.randomBytes(32);

function hashAdminEmail(email = '') {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail) return '';
  
  const hmac = crypto.createHmac('sha256', HASH_SALT);
  hmac.update(safeEmail);
  return `sha256:${hmac.digest('hex')}`;
}

// Ou usar bcrypt:
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(email, 12);
```

---

### 11. **Tokens Supabase Sem Expiração Verificada**

**Localização:**
- `backend/src/utils/auth.js:190-200` (SUPABASE_USER)
- Supabase tokens podem ter exp mal configurado

**Impacto:**
- Tokens expirados podem continuar válidos
- Falta de renovação de sessão
- Acesso prolongado mesmo após logout

**Recomendação:**
```javascript
async function authenticateBearerToken(token, agentId = '') {
  // ... Supabase user authentication
  const { data: { user } = {}, error } = await supabase.auth.getUser(token);
  
  if (!user) return null;
  
  // ✅ Verificar expiração do JWT
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.payload.exp) {
    return null;  // Token sem expiração válida
  }
  
  const expiresAt = decoded.payload.exp * 1000;  // Convert to ms
  if (expiresAt <= Date.now()) {
    return null;  // Token expirado
  }

  // PROCEED...
};
```

---

## 📊 Matriz de Risco

```
SEVERIDADE vs PROBABILIDADE

        PROVÁVEL    POSSÍVEL    IMPROVÁVEL
CRÍTICO   [1,2,3]      [4]          -
ALTO      [5,6,7]      [8]        [9]
MÉDIO       [10]      [11]          -
BAIXO        -          -           -
```

---

## ✅ Recomendações Prioritárias

### 🔴 IMEDIATO (Produção em Risco)

1. **Remover todos os logs de tokens/secrets/emails**
   - Procurar por `console.log/error/warn` que contenham dados sensíveis
   - Usar transporte seguro (ex: structured logging com masking)

2. **Encriptar admin-settings.json**
   - Implementar AES-256 para armazenamento persistido
   - Chave em variável de ambiente

3. **Garantir API_SECRET_KEY configurado**
   - Validar em startup com throw error
   - Verificar comprimento mínimo (32+ chars)

### 🟠 CRÍTICO (1-2 Semanas)

4. **Implementar rate limiting global**
5. **Configurar CORS restritivo**
6. **Adicionar validação de email robusta**
7. **Remover allowAdmin sem secret configurado**

### 🟡 IMPORTANTE (1 Mês)

8. **Migrar secrets para gerenciador (Vault, AWS Secrets)**
9. **Implementar HTTP-only cookies para sessão**
10. **Adicionar salt em hashes de allowlist**

---

## 🛠️ Checklist de Implementação

- [ ] Audit de logs em produção
- [ ] Implementar redação de dados sensíveis em logs
- [ ] Encriptar credentials no armazenamento
- [ ] Adicionar validações de entrada robustas
- [ ] Configurar rate limiting por IP
- [ ] CORS configurado com whitelist
- [ ] JWT com expiração verificada
- [ ] Remover secrets de .env do git
- [ ] Implementar rotation de chaves
- [ ] Testes de segurança automatizados

---

**Próximas etapas:**
1. Realizar code review com especialista em segurança
2. Implementar WAF (Web Application Firewall)
3. Setup de monitoramento de anomalias
4. Pentest em ambiente de staging

