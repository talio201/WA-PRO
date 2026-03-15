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
  const { status, qrCodeBase64, agentId } = req.body;
  const targetId = agentId || req.agentId || "system";
  
  const currentState = botStates.get(targetId) || { status: 'DISCONNECTED', qrCode: null };
  if (status) currentState.status = status;
  if (qrCodeBase64 !== undefined) currentState.qrCode = qrCodeBase64;
  
  botStates.set(targetId, currentState);
  
  emitRealtimeEvent("bot.status", { ...currentState, agentId: targetId });
  res.json({ success: true, botState: currentState });
});

app.get("/api/bot/status", requireAuth, (req, res) => {
  const agentId = req.headers["x-agent-id"] || req.query.agentId || req.agentId || "system";
  const state = botStates.get(agentId) || { status: 'DISCONNECTED', qrCode: null };
  res.json(state);
});

app.use("/api/public", require("./routes/publicRoutes"));

// Protected API routes
app.use("/api", requireAuth);

// Track user activity for admin dashboard
const adminController = require("./controllers/adminController");
const { trackUserActivity } = adminController;
app.use(trackUserActivity);

app.get('/api/admin/access/me', adminController.getMyAdminAccess);

app.use("/api/admin", requireAdminAccess, require("./routes/adminRoutes"));
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/contacts", require("./routes/contactRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

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
