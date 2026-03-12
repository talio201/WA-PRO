const fs = require("fs");
const path = require("path");
const LOG_PATH = path.join(__dirname, "../../send_flow.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
function isLoggingEnabled() {
  return String(process.env.ENABLE_SEND_FLOW_LOGGER || "false").trim() === "true";
}
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const stats = fs.statSync(LOG_PATH);
    if (stats.size < MAX_LOG_BYTES) return;
    fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
  } catch (error) {}
}
function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted = {};
  for (const [key, current] of Object.entries(value)) {
    const safeKey = String(key || "").toLowerCase();
    if (
      safeKey.includes("password") ||
      safeKey.includes("authorization") ||
      safeKey.includes("token") ||
      safeKey.includes("secret") ||
      safeKey.includes("apikey") ||
      safeKey === "text" ||
      safeKey === "message"
    ) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    redacted[key] = redactSensitive(current);
  }
  return redacted;
}
function logSendFlow(event, data = {}) {
  if (!isLoggingEnabled()) return;
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...redactSensitive(data),
  };
  rotateIfNeeded();
  fs.appendFileSync(LOG_PATH, JSON.stringify(logEntry) + "\n");
}
function sendFlowLogger(req, res, next) {
  logSendFlow("request", {
    method: req.method,
    path: req.originalUrl || req.path,
    body: req.body,
  });
  next();
}
function logSendResult({ jobId, status, error, extra }) {
  logSendFlow("send_result", {
    jobId,
    status,
    error: error ? error.message || error : null,
    extra,
  });
}
module.exports = {
  sendFlowLogger,
  logSendResult,
};
