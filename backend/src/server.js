require("dotenv").config();
const express = require("express");
const cors = require("cors");
let helmet = null;
try {
  helmet = require('helmet');
} catch (e) {
  console.warn('[startup] optional dependency "helmet" not installed, continuing without it.');
}
const rateLimit = require('express-rate-limit');
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require('crypto');
const { spawn } = require("child_process");
const {
  initRealtimeServer,
  emitRealtimeEvent,
} = require("./realtime/realtime");
const Campaign = require('./models/Campaign');
const Message = require('./models/Message');
const { getNextBotCommand } = require("./config/botControlStore");
const requireAuth = require("./middleware/authMiddleware");
const { requireAdminAccess } = require("./middleware/adminAccessMiddleware");

const app = express();
const maintenanceBasePath = (`/${String(process.env.ADMIN_PORTAL_PATH || 'painel-interno').trim().replace(/^\/+|\/+$/g, '')}`).replace(/\/+/g, '/');
const blockedMaintenancePublicPaths = new Set(['/login.html', '/dashboard.html', '/admin.html']);

// Enable trust proxy for Cloudflare/Proxy environments
app.set("trust proxy", 1);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiter (basic)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 1000), // Increased to 1000 to avoid common 429 when polling
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(apiLimiter);

// CORS whitelist: read from env or fall back to localhost
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5176').split(',').map((s) => String(s || '').trim()).filter(Boolean);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS origin ${origin} not allowed`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "x-agent-id"],
};
app.use(cors(corsOptions));
app.use(express.json({ extended: false, limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

// 1. Health check - Always available
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Backend is running and healthy" });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Backend is running and healthy" });
});

app.get("/", (_req, res) => {
  return res.redirect(302, "/usuarios");
});

app.get("/index.html", (_req, res) => {
  return res.redirect(302, "/usuarios");
});

app.use((req, res, next) => {
  if (blockedMaintenancePublicPaths.has(req.path)) {
    return res.status(404).send('Not found');
  }
  return next();
});

// 2. Serve static files FIRST
app.use(express.static(path.join(__dirname, "../public"), {
  maxAge: "1d",
  etag: false,
  setHeaders: (res, filePath) => {
    if (String(filePath || '').endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }
}));

app.use("/uploads", express.static(path.join(__dirname, "../uploads"), {
  maxAge: "7d"
}));

const { sendFlowLogger } = require("./monitorSendFlow");
// Wrap sendFlowLogger to avoid uncaught exceptions bubbling and to forward errors to the global handler
app.use("/api/messages", (req, res, next) => {
  try {
    const maybePromise = sendFlowLogger(req, res, next);
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.catch(next);
    }
  } catch (err) {
    next(err);
  }
});

// Bot status endpoints - multi-tenant
const botStates = new Map(); // agentId -> { status, qrCode, lastSeen }
// TTL cleanup for botStates to avoid memory leaks
const BOTSTATE_TTL_MS = Number(process.env.BOTSTATE_TTL_MS || 15 * 60 * 1000);
const BOTSTATE_CLEANUP_INTERVAL_MS = Number(process.env.BOTSTATE_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);
setInterval(() => {
  try {
    const now = Date.now();
    for (const [key, state] of botStates.entries()) {
      if (!state || !state.lastSeen) {
        // if no lastSeen, keep it but set a baseline
        continue;
      }
      if (now - state.lastSeen > BOTSTATE_TTL_MS) {
        botStates.delete(key);
      }
    }
  } catch (e) {
    console.error('[botStates] cleanup error', e);
  }
}, BOTSTATE_CLEANUP_INTERVAL_MS);

app.post("/api/bot/status", requireAuth, (req, res) => {
  if (req.user && !req.isAdmin) {
    const status = String(req.saasUser?.status || 'pending').trim().toLowerCase();
    if (status !== 'active') {
      return res.status(403).json({ msg: 'Conta aguardando aprovação para ativar WhatsApp.' });
    }
    if (req.saasUser?.expiresAt && new Date(req.saasUser.expiresAt).getTime() <= Date.now()) {
      return res.status(403).json({ msg: 'Licença expirada para ativação do WhatsApp.' });
    }
  }
  const { status, qrCodeBase64, agentId } = req.body;
  const targetId = (req.user && !req.isAdmin)
    ? req.agentId
    : (agentId || req.agentId || "system");
  
  const oldStatus = botStates.get(targetId)?.status;
  const currentState = botStates.get(targetId) || { status: 'DISCONNECTED', qrCode: null };
  if (status) currentState.status = status;
  if (qrCodeBase64 !== undefined) currentState.qrCode = qrCodeBase64;
  currentState.lastSeen = Date.now();
  
  botStates.set(targetId, currentState);
  
  if (oldStatus !== currentState.status) { emitRealtimeEvent("bot.status", { status: currentState.status, agentId: targetId }); }
  res.json({ success: true, botState: currentState });
});

app.get("/api/bot/status", requireAuth, (req, res) => {
  if (req.user && !req.isAdmin) {
    const status = String(req.saasUser?.status || 'pending').trim().toLowerCase();
    if (status !== 'active') {
      return res.status(403).json({
        status: 'PENDING_APPROVAL',
        msg: 'Conta aguardando aprovação administrativa.',
      });
    }
    if (req.saasUser?.expiresAt && new Date(req.saasUser.expiresAt).getTime() <= Date.now()) {
      return res.status(403).json({
        status: 'LICENSE_EXPIRED',
        msg: 'Licença expirada.',
      });
    }
  }
  const requestedAgentId = req.headers["x-agent-id"] || req.query.agentId;
  const targetAgentId = (req.user && !req.isAdmin && requestedAgentId !== "bot")
    ? req.agentId
    : (requestedAgentId || req.agentId || "system");
  const state = botStates.get(targetAgentId) || { status: 'DISCONNECTED', qrCode: null };
  
  res.json(state);
});

app.get('/api/bot/commands/next', requireAuth, (req, res) => {
  const agentId = String(req.headers['x-agent-id'] || req.query.agentId || req.agentId || '').trim();
  if (!agentId) {
    return res.status(400).json({ msg: 'agentId is required' });
  }
  const command = getNextBotCommand(agentId);
  return res.json({ success: true, command: command || null });
});

app.get('/api/bot/instances', requireAuth, require('./controllers/messageController').getBotInstancesForSupervisor);

app.use("/api/public", require("./routes/publicRoutes"));

// Protected API routes
app.use("/api", requireAuth);

app.get('/api/account/status', (req, res) => {
  const saasUser = req.saasUser || null;
  const isAdmin = req.user && req.isAdmin === true;
  const now = Date.now();
  const expiresAt = saasUser?.expiresAt || null;
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= now);
  const status = isAdmin
    ? 'active'
    : String(saasUser?.status || 'pending').trim().toLowerCase();

  console.log('[DEBUG] /api/account/status accessed by', req.user?.email, 'agent:', req.agentId, 'status:', status, 'isAdmin:', isAdmin);

  return res.json({
    success: true,
    account: {
      email: req.user?.email || null,
      agentId: req.agentId || null,
      status: expired ? 'expired' : status,
      isAdmin,
      planTerm: saasUser?.planTerm || null,
      expiresAt,
      activationCode: saasUser?.activationCode || null,
      clientId: saasUser?.clientId || null,
    },
  });
});

function requireActiveSaasAccount(req, res, next) {
  // Allow admin and API keys (bot authentication)
  if (req.isAdmin === true) return next();
  if (req.permissions?.allowCampaigns === true) return next(); // API key authenticated
  
  // For Supabase users only
  if (!req.user) return next();
  const lastSignInAt = req.user?.last_sign_in_at ? new Date(req.user.last_sign_in_at).getTime() : 0;
  if (Number.isFinite(lastSignInAt) && lastSignInAt > 0) {
    const elapsedMs = Date.now() - lastSignInAt;
    if (elapsedMs > 24 * 60 * 60 * 1000) {
      return res.status(401).json({
        msg: 'Sessão expirada por política de segurança (24h). Faça login novamente.',
        accountStatus: 'session_refresh_required',
      });
    }
  }
  const saasUser = req.saasUser || null;
  const status = String(saasUser?.status || 'pending').trim().toLowerCase();
  if (status !== 'active') {
    return res.status(403).json({
      msg: 'Sua conta está aguardando aprovação administrativa.',
      accountStatus: status,
    });
  }
  if (saasUser?.expiresAt && new Date(saasUser.expiresAt).getTime() <= Date.now()) {
    return res.status(403).json({
      msg: 'Sua licença expirou. Solicite renovação ao administrador.',
      accountStatus: 'expired',
    });
  }
  return next();
}

async function enforceDemoOutboundPolicy(req, res, next) {
  try {
    if (!req.user || req.isAdmin === true) return next();
    const planTerm = String(req.saasUser?.planTerm || '').trim().toLowerCase();
    if (planTerm !== 'demo') return next();

    const agentCampaigns = await Campaign.find({ agentId: req.agentId }).select('_id');
    const campaignIds = (Array.isArray(agentCampaigns) ? agentCampaigns : []).map((item) => item._id);
    if (!campaignIds.length) return next();

    const allOutbound = await Message.find({
      campaign: { $in: campaignIds },
      direction: 'outbound',
    });
    const sentCount = Array.isArray(allOutbound) ? allOutbound.length : 0;
    if (sentCount >= 10) {
      return res.status(403).json({
        msg: 'Plano DEMO permite até 10 mensagens. Solicite upgrade para continuar.',
        code: 'demo_limit_reached',
      });
    }

    const inFlight = await Message.find({
      campaign: { $in: campaignIds },
      direction: 'outbound',
      status: { $in: ['pending', 'processing'] },
    });
    if (Array.isArray(inFlight) && inFlight.length > 0) {
      return res.status(429).json({
        msg: 'Plano DEMO permite apenas um envio por vez. Aguarde o envio atual finalizar.',
        code: 'demo_single_flight_required',
      });
    }

    return next();
  } catch (_error) {
    return res.status(500).json({ msg: 'Falha ao validar política DEMO.' });
  }
}

// Track user activity for admin dashboard
const adminController = require("./controllers/adminController");
const { trackUserActivity } = adminController;
app.use(trackUserActivity);

app.get('/api/admin/access/me', adminController.getMyAdminAccess);

app.use("/api/admin", requireAdminAccess, require("./routes/adminRoutes"));
app.use('/api/campaigns', requireActiveSaasAccount, (req, res, next) => {
  const planTerm = String(req.saasUser?.planTerm || '').trim().toLowerCase();
  if (req.user && !req.isAdmin && planTerm === 'demo' && req.method !== 'GET') {
    return res.status(403).json({
      msg: 'Plano DEMO não permite disparos de campanha. Use envio manual de teste.',
      code: 'demo_campaigns_blocked',
    });
  }
  return next();
}, require("./routes/campaignRoutes"));
app.post('/api/messages/outbound/manual', requireActiveSaasAccount, enforceDemoOutboundPolicy);
app.use('/api/messages', requireActiveSaasAccount, require("./routes/messageRoutes"));
app.use('/api/contacts', requireActiveSaasAccount, require("./routes/contactRoutes"));
app.use('/api/upload', requireActiveSaasAccount, require("./routes/uploadRoutes"));
app.use('/api/ai', requireActiveSaasAccount, require("./routes/aiRoutes"));

// 3. Web app (SaaS) - serve Vite build under /usuarios
app.use("/usuarios", express.static(path.join(__dirname, "../public/app"), {
  index: false,
  maxAge: "1d",
  etag: false
}));
app.get("/usuarios", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/app/index.html"));
});
app.get("/usuarios.html", (req, res) => {
  res.redirect(302, "/usuarios");
});
app.get("/usuarios/*", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/app/index.html"));
});

// Convenience redirects for common admin paths so older links keep working
app.get('/admin', (req, res) => {
  return res.redirect(302, maintenanceBasePath);
});
app.get('/admin/', (req, res) => {
  return res.redirect(302, maintenanceBasePath);
});
app.get('/admin/dashboard', (req, res) => {
  return res.redirect(302, `${maintenanceBasePath}/dashboard`);
});
app.get('/painel-interno', (req, res) => {
  return res.redirect(302, maintenanceBasePath);
});

app.get(maintenanceBasePath, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

app.get(`${maintenanceBasePath}/dashboard`, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get(`${maintenanceBasePath}/admin`, (req, res) => {
  // Generate a per-request nonce and set a CSP that allows specific CDNs and this nonce for inline scripts
  try {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptSrc = ["'self'", `'nonce-${nonce}'`, 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'];
    const styleSrc = ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.tailwindcss.com', "'unsafe-inline'"];
    const connectSrc = ["'self'", 'wss:', 'https:', 'http:'];
    const csp = `default-src 'self'; script-src ${scriptSrc.join(' ')}; style-src ${styleSrc.join(' ')}; connect-src ${connectSrc.join(' ')}; img-src 'self' data:; font-src 'self' https://cdnjs.cloudflare.com; object-src 'none'; frame-ancestors 'none'`;
    // res.setHeader('Content-Security-Policy', csp);
    const filePath = path.join(__dirname, "../public/admin.html");
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return res.status(500).send('Failed to load admin panel');
      // Replace placeholder tokens with the generated nonce
      const out = data.replace(/__CSP_NONCE__/g, nonce);
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.send(out);
    });
  } catch (e) {
    console.error('[CSP] admin page render error', e);
    res.status(500).send('Failed to render admin page');
  }
});

// 4. SPA Fallback - Redirect unmatched non-API routes to login.html
app.get("*", (req, res) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    return res.status(404).json({ msg: "Not found" });
  }
  return res.redirect(302, "/usuarios");
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ msg: "Invalid payload." });
  }
  return next(err);
});
// Global error handler (final)
app.use((err, req, res, next) => {
  try {
    console.error('[ERROR]', err && err.stack ? err.stack : err);
  } catch (e) {
    // noop
  }
  const status = err && err.status && Number(err.status) ? Number(err.status) : 500;
  const message = (err && err.message) ? err.message : 'Erro interno do servidor.';
  res.status(status).json({ error: message });
});
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Export app for testing. Only start the server when this file is run directly.
if (require.main === module) {
  initRealtimeServer(server);
  server.listen(PORT, () => {
    emitRealtimeEvent("system.server_started", {
      port: Number(PORT),
      storageProvider: String(
        process.env.STORAGE_PROVIDER || process.env.DB_PROVIDER || "local",
      ).toLowerCase(),
    });
  });
}

module.exports = { app, server };

