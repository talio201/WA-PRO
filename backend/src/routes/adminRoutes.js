const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

// Dashboard overview
router.get("/dashboard", adminController.getDashboard);

// Users management
router.get("/users", adminController.getActiveUsers);
router.get("/users/permissions", adminController.getUserPermissions);
router.post("/users/permission", adminController.setUserPermission);
router.post("/users/disconnect", adminController.disconnectUser);

// System metrics
router.get("/metrics", adminController.getMetrics);

// Runtime config & provisioning
router.get("/runtime-config", adminController.getRuntimeConfig);
router.put("/runtime-config", adminController.updateRuntimeConfig);
router.get("/clients", adminController.listBotClients);
router.post("/clients", adminController.createBotClient);
router.patch("/clients/:clientId", adminController.updateBotClient);
router.post("/clients/:clientId/rotate-key", adminController.rotateBotClientKey);
router.get("/clients/:clientId/provision", adminController.getBotProvision);

// Security logs
router.get("/security", adminController.getSecurityLogs);
router.post("/security/report", adminController.reportSecurityEvent);

// Bot activity
router.get("/bot/activity", adminController.getBotActivity);
router.post("/bot/activity", adminController.reportBotActivity);

// Extension errors
router.get("/extension/errors", adminController.getExtensionErrors);
router.post("/extension/errors", adminController.reportExtensionError);

// Extension distribution
router.get("/extension/info", adminController.getExtensionInfo);
router.get("/extension/download", adminController.downloadExtension);
router.post("/extension/send-email", adminController.sendExtensionEmail);

// Cache management
router.post("/cache/clear", adminController.clearCache);

// Realtime
router.get("/realtime/info", adminController.getRealtimeInfo);
router.post("/broadcast", adminController.broadcast);

module.exports = router;
