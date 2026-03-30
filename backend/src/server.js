require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const fs = require("fs");
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

// CORS whitelist - permit all origins for web access
const corsOptions = {
  origin: true,
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
  etag: false
}));

app.use("/uploads", express.static(path.join(__dirname, "../uploads"), {
  maxAge: "7d"
}));

const { sendFlowLogger } = require("./monitorSendFlow");
app.use("/api/messages", sendFlowLogger);

// Bot status endpoints - multi-tenant
const botStates = new Map(); // agentId -> { status, qrCode }

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
  
  const oldStatus = botStates.get(targetId)?.status; const currentState = botStates.get(targetId) || { status: 'DISCONNECTED', qrCode: null };
  if (status) currentState.status = status;
  if (qrCodeBase64 !== undefined) currentState.qrCode = qrCodeBase64;
  
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
  const targetAgentId = (req.user && !req.isAdmin)
    ? req.agentId
    : (req.headers["x-agent-id"] || req.query.agentId || req.agentId || "system");
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

app.get(maintenanceBasePath, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

app.get(`${maintenanceBasePath}/dashboard`, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get(`${maintenanceBasePath}/admin`, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "../public/admin.html"));
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
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
initRealtimeServer(server);
server.listen(PORT, () => {
  emitRealtimeEvent("system.server_started", {
    port: Number(PORT),
    storageProvider: String(
      process.env.STORAGE_PROVIDER || process.env.DB_PROVIDER || "local",
    ).toLowerCase(),
  });
});

