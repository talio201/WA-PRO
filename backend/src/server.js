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

const app = express();

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

// Bot status endpoints - public (before auth middleware)
let botState = { status: 'DISCONNECTED', qrCode: null };

app.post("/api/bot/status", (req, res) => {
  const { status, qrCodeBase64 } = req.body;
  if (status) botState.status = status;
  if (qrCodeBase64 !== undefined) botState.qrCode = qrCodeBase64;
  
  emitRealtimeEvent("bot.status", botState);
  res.json({ success: true, botState });
});

app.get("/api/bot/status", (req, res) => {
  res.json(botState);
});

// Protected API routes
app.use("/api", requireAuth);

// Track user activity for admin dashboard
const { trackUserActivity } = require("./controllers/adminController");
app.use(trackUserActivity);

app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/contacts", require("./routes/contactRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

// 3. SPA Fallback - Redirect unmatched non-API routes to login.html
app.get("*", (req, res) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    return res.status(404).json({ msg: "Not found" });
  }
  res.sendFile(path.join(__dirname, "../public/login.html"));
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
