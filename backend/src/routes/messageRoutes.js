const express = require("express");
const router = express.Router();
const {
  getMessages,
  getConversations,
  getConversationHistory,
  getNextJob,
  updateJobStatus,
  getMessageAudit,
  updateMessage,
  retryMessage,
  assignConversation,
  releaseConversation,
  registerInboundMessage,
  registerManualOutbound,
  syncConversationHistory,
  requestHistorySync,
} = require("../controllers/messageController");
router.get("/", getMessages);
router.get("/conversations", getConversations);
router.get("/conversations/:phone/history", getConversationHistory);
router.post("/conversations/:phone/history/sync", syncConversationHistory);
router.post("/history/request-sync", requestHistorySync);
router.get("/next", getNextJob);
router.post("/inbound", registerInboundMessage);
router.post("/outbound/manual", registerManualOutbound);
router.put("/conversations/:phone/assign", assignConversation);
router.post("/conversations/:phone/release", releaseConversation);
router.put("/:id/status", updateJobStatus);
router.post("/status", updateJobStatus);
router.get("/:id/audit", getMessageAudit);
router.patch("/:id", updateMessage);
router.post("/:id/retry", retryMessage);
module.exports = router;
