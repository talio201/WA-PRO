const fs = require("fs");
const path = require("path");
const LOG_PATH = path.join(__dirname, "../../send_flow.log");
function logSendFlow(event, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
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
