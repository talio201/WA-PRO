const os = require("os");
const fs = require("fs");
const path = require("path");
const { emitRealtimeEvent } = require("../realtime/realtime");

// In-memory stores for tracking
const activeUsers = new Map();
const securityLogs = [];
const extensionErrors = [];
const botActivityLogs = [];
const systemMetricsHistory = [];

// Track active user sessions
const trackUser = (agentId, metadata = {}) => {
  const now = Date.now();
  activeUsers.set(agentId, {
    agentId,
    lastActivity: now,
    connectedAt: activeUsers.get(agentId)?.connectedAt || now,
    ...metadata,
  });
};

// Log security event
const logSecurityEvent = (type, data) => {
  const event = {
    id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };
  securityLogs.unshift(event);
  if (securityLogs.length > 1000) securityLogs.pop();
  emitRealtimeEvent("admin.security", event);
  return event;
};

// Log bot activity
const logBotActivity = (action, data) => {
  const event = {
    id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    action,
    timestamp: new Date().toISOString(),
    ...data,
  };
  botActivityLogs.unshift(event);
  if (botActivityLogs.length > 500) botActivityLogs.pop();
  emitRealtimeEvent("admin.bot_activity", event);
  return event;
};

// Log extension error
const logExtensionError = (error) => {
  const event = {
    id: `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...error,
  };
  extensionErrors.unshift(event);
  if (extensionErrors.length > 500) extensionErrors.pop();
  emitRealtimeEvent("admin.extension_error", event);
  return event;
};

// Get system metrics
const getSystemMetrics = () => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Calculate CPU usage
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  const metrics = {
    timestamp: new Date().toISOString(),
    cpu: {
      usage: parseFloat(cpuUsage),
      cores: cpus.length,
      model: cpus[0]?.model || "Unknown",
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: ((usedMem / totalMem) * 100).toFixed(1),
    },
    uptime: {
      system: os.uptime(),
      process: process.uptime(),
    },
    platform: {
      type: os.type(),
      release: os.release(),
      hostname: os.hostname(),
      arch: os.arch(),
    },
    network: Object.entries(os.networkInterfaces())
      .flatMap(([name, interfaces]) =>
        interfaces
          .filter((i) => !i.internal && i.family === "IPv4")
          .map((i) => ({ name, address: i.address }))
      )
      .slice(0, 3),
    process: {
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
    },
  };

  systemMetricsHistory.unshift(metrics);
  if (systemMetricsHistory.length > 60) systemMetricsHistory.pop();

  return metrics;
};

// Clean inactive users (inactive for more than 5 minutes)
const cleanInactiveUsers = () => {
  const threshold = Date.now() - 5 * 60 * 1000;
  for (const [agentId, user] of activeUsers.entries()) {
    if (user.lastActivity < threshold) {
      activeUsers.delete(agentId);
    }
  }
};

// Permission system
const userPermissions = new Map();

const setUserPermission = (agentId, allowed) => {
  userPermissions.set(agentId, {
    allowed,
    updatedAt: new Date().toISOString(),
  });
  logSecurityEvent("permission_change", { agentId, allowed });
};

const checkUserPermission = (agentId) => {
  const permission = userPermissions.get(agentId);
  if (!permission) return true; // Default: allowed
  return permission.allowed;
};

// ============ CONTROLLERS ============

// Get dashboard overview
exports.getDashboard = async (req, res) => {
  try {
    cleanInactiveUsers();
    const metrics = getSystemMetrics();

    const dashboard = {
      activeUsers: Array.from(activeUsers.values()),
      totalActiveUsers: activeUsers.size,
      systemMetrics: metrics,
      recentSecurityLogs: securityLogs.slice(0, 10),
      recentBotActivity: botActivityLogs.slice(0, 10),
      recentExtensionErrors: extensionErrors.slice(0, 10),
      serverStartTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    };

    res.json(dashboard);
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ msg: "Failed to get dashboard data" });
  }
};

// Get active users
exports.getActiveUsers = async (req, res) => {
  try {
    cleanInactiveUsers();
    const users = Array.from(activeUsers.values()).map((user) => ({
      ...user,
      permission: checkUserPermission(user.agentId),
      sessionDuration: Date.now() - user.connectedAt,
    }));
    res.json({ users, total: users.length });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get active users" });
  }
};

// Track user activity (called from middleware)
exports.trackUserActivity = (req, res, next) => {
  const agentId = req.headers["x-agent-id"] || req.agentId;
  if (agentId) {
    trackUser(agentId, {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
      lastEndpoint: req.originalUrl,
      method: req.method,
    });
  }
  next();
};

// Get system metrics
exports.getMetrics = async (req, res) => {
  try {
    const metrics = getSystemMetrics();
    res.json({
      current: metrics,
      history: systemMetricsHistory.slice(0, 30),
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get metrics" });
  }
};

// Get security logs
exports.getSecurityLogs = async (req, res) => {
  try {
    const { limit = 100, type } = req.query;
    let logs = securityLogs;
    if (type) {
      logs = logs.filter((log) => log.type === type);
    }
    res.json({
      logs: logs.slice(0, parseInt(limit)),
      total: logs.length,
      types: [...new Set(securityLogs.map((l) => l.type))],
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get security logs" });
  }
};

// Report security event (for tracking intrusion attempts)
exports.reportSecurityEvent = async (req, res) => {
  try {
    const { type, details } = req.body;
    const event = logSecurityEvent(type || "unknown", {
      details,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
      agentId: req.headers["x-agent-id"],
    });
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ msg: "Failed to report security event" });
  }
};

// Get bot activity logs
exports.getBotActivity = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    res.json({
      logs: botActivityLogs.slice(0, parseInt(limit)),
      total: botActivityLogs.length,
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get bot activity" });
  }
};

// Report bot activity
exports.reportBotActivity = async (req, res) => {
  try {
    const { action, data } = req.body;
    const event = logBotActivity(action, data);
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ msg: "Failed to report bot activity" });
  }
};

// Get extension errors
exports.getExtensionErrors = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    res.json({
      errors: extensionErrors.slice(0, parseInt(limit)),
      total: extensionErrors.length,
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get extension errors" });
  }
};

// Report extension error
exports.reportExtensionError = async (req, res) => {
  try {
    const { error, stack, context } = req.body;
    const event = logExtensionError({
      error,
      stack,
      context,
      agentId: req.headers["x-agent-id"],
      userAgent: req.headers["user-agent"],
    });
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ msg: "Failed to report extension error" });
  }
};

// User permission management
exports.getUserPermissions = async (req, res) => {
  try {
    const permissions = Array.from(userPermissions.entries()).map(
      ([agentId, data]) => ({
        agentId,
        ...data,
      })
    );
    res.json({ permissions });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get permissions" });
  }
};

exports.setUserPermission = async (req, res) => {
  try {
    const { agentId, allowed } = req.body;
    if (!agentId) {
      return res.status(400).json({ msg: "agentId is required" });
    }
    setUserPermission(agentId, allowed !== false);
    res.json({ success: true, agentId, allowed: allowed !== false });
  } catch (err) {
    res.status(500).json({ msg: "Failed to set permission" });
  }
};

// Disconnect/logout user
exports.disconnectUser = async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) {
      return res.status(400).json({ msg: "agentId is required" });
    }
    activeUsers.delete(agentId);
    setUserPermission(agentId, false);
    emitRealtimeEvent("admin.user_disconnected", { agentId });
    logSecurityEvent("user_disconnected", { agentId, by: req.headers["x-agent-id"] });
    res.json({ success: true, agentId });
  } catch (err) {
    res.status(500).json({ msg: "Failed to disconnect user" });
  }
};

// Clear cache
exports.clearCache = async (req, res) => {
  try {
    const { type = "all" } = req.body;
    let cleared = [];

    if (type === "all" || type === "metrics") {
      systemMetricsHistory.length = 0;
      cleared.push("metrics");
    }
    if (type === "all" || type === "security") {
      securityLogs.length = 0;
      cleared.push("security");
    }
    if (type === "all" || type === "bot") {
      botActivityLogs.length = 0;
      cleared.push("bot");
    }
    if (type === "all" || type === "extension") {
      extensionErrors.length = 0;
      cleared.push("extension");
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      cleared.push("gc");
    }

    logSecurityEvent("cache_cleared", { type, cleared, by: req.headers["x-agent-id"] });
    res.json({ success: true, cleared });
  } catch (err) {
    res.status(500).json({ msg: "Failed to clear cache" });
  }
};

// Download extension
exports.downloadExtension = async (req, res) => {
  try {
    const extensionPath = path.join(__dirname, "../../../extension/dist");
    const zipPath = path.join(__dirname, "../../uploads/extension.zip");

    // Check if dist exists
    if (!fs.existsSync(extensionPath)) {
      return res.status(404).json({ msg: "Extension not built. Run 'npm run build' in extension folder." });
    }

    // Check if zip already exists and is recent (less than 1 hour old)
    if (fs.existsSync(zipPath)) {
      const stats = fs.statSync(zipPath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs < 3600000) {
        return res.download(zipPath, "EmidiaWhats-Extension.zip");
      }
    }

    // Create zip using built-in archiver or return folder info
    res.json({
      msg: "Extension available",
      path: "/uploads/extension.zip",
      buildInstructions: "Run 'npm run build' in extension folder, then zip the dist folder",
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to prepare extension download" });
  }
};

// Get extension download link
exports.getExtensionInfo = async (req, res) => {
  try {
    const extensionPath = path.join(__dirname, "../../../extension/dist");
    const manifestPath = path.join(extensionPath, "manifest.json");

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    }

    res.json({
      available: fs.existsSync(extensionPath),
      manifest,
      downloadUrl: "/api/admin/extension/download",
      instructions: [
        "1. Clique em Download para baixar a extensão",
        "2. Extraia o arquivo ZIP",
        "3. Abra chrome://extensions no Chrome",
        "4. Ative 'Modo do desenvolvedor'",
        "5. Clique em 'Carregar sem compactação'",
        "6. Selecione a pasta extraída",
      ],
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get extension info" });
  }
};

// Send extension via email (placeholder - needs email service setup)
exports.sendExtensionEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ msg: "Email is required" });
    }

    // TODO: Implement email sending with nodemailer or similar
    // For now, return instructions
    res.json({
      success: false,
      msg: "Email service not configured. Configure SMTP in .env",
      alternativeUrl: `${process.env.BASE_URL || "https://tcgsolucoes.app"}/api/admin/extension/download`,
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to send extension email" });
  }
};

// Real-time stream endpoint info
exports.getRealtimeInfo = async (req, res) => {
  try {
    res.json({
      wsUrl: "/ws",
      events: [
        "admin.security",
        "admin.bot_activity",
        "admin.extension_error",
        "admin.user_disconnected",
        "admin.metrics",
        "bot.status",
        "message.sent",
        "message.failed",
        "campaign.progress",
      ],
      instructions: "Connect to WebSocket at /ws to receive real-time events",
    });
  } catch (err) {
    res.status(500).json({ msg: "Failed to get realtime info" });
  }
};

// Broadcast message to all connected clients
exports.broadcast = async (req, res) => {
  try {
    const { event, data } = req.body;
    if (!event) {
      return res.status(400).json({ msg: "Event name is required" });
    }
    emitRealtimeEvent(event, data || {});
    res.json({ success: true, event, data });
  } catch (err) {
    res.status(500).json({ msg: "Failed to broadcast" });
  }
};

// Export functions for use in other modules
exports.trackUser = trackUser;
exports.logSecurityEvent = logSecurityEvent;
exports.logBotActivity = logBotActivity;
exports.logExtensionError = logExtensionError;
exports.checkUserPermission = checkUserPermission;
