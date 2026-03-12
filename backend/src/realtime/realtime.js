const crypto = require("crypto");
const { URL } = require("url");
const { WebSocketServer } = require("ws");
const { authenticateBearerToken } = require("../utils/auth");
let wsServer = null;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 8000;
const DEFAULT_WEBHOOK_RETRIES = 2;
function parseWebhookTargets() {
  const raw = String(
    process.env.WEBHOOK_TARGETS || process.env.WEBHOOK_URLS || "",
  ).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function getWebhookSecret() {
  return String(process.env.WEBHOOK_SECRET || "").trim();
}
function buildEnvelope(event, data = {}) {
  return {
    type: "event",
    event,
    data,
    at: new Date().toISOString(),
  };
}
function broadcastEnvelope(envelope) {
  if (!wsServer) return;
  const payload = JSON.stringify(envelope);
  wsServer.clients.forEach((client) => {
    if (client.readyState === 1 && client.isAuthorized) {
      try {
        client.send(payload);
      } catch (error) {}
    }
  });
}
async function authorizeRealtimeRequest(request) {
  try {
    const requestUrl = new URL(request.url || "/ws", "http://localhost");
    const tokenFromQuery = String(
      requestUrl.searchParams.get("access_token") ||
        requestUrl.searchParams.get("token") ||
        "",
    ).trim();
    const authHeader = String(request.headers?.authorization || "").trim();
    const tokenFromHeader = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const token = tokenFromQuery || tokenFromHeader;
    const agentId = String(requestUrl.searchParams.get("agentId") || "").trim();
    if (!token) return null;
    return authenticateBearerToken(token, agentId);
  } catch (error) {
    return null;
  }
}
function buildWebhookSignature(payload) {
  const secret = getWebhookSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
async function postWebhookTarget(
  target,
  envelope,
  attempt = 1,
  maxAttempts = DEFAULT_WEBHOOK_RETRIES,
) {
  const payload = JSON.stringify(envelope);
  const signature = buildWebhookSignature(payload);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DEFAULT_WEBHOOK_TIMEOUT_MS,
  );
  try {
    const headers = {
      "Content-Type": "application/json",
      "X-WA-Event": envelope.event,
    };
    if (signature) {
      headers["X-WA-Signature"] = signature;
    }
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    if (response.ok) {
      return true;
    }
    const body = await response.text();
    if (attempt >= maxAttempts) {
      console.warn(
        `Webhook delivery failed (${response.status}) to ${target}: ${body}`,
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    return postWebhookTarget(target, envelope, attempt + 1, maxAttempts);
  } catch (error) {
    if (attempt >= maxAttempts) {
      console.warn(`Webhook delivery error to ${target}: ${error.message}`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    return postWebhookTarget(target, envelope, attempt + 1, maxAttempts);
  } finally {
    clearTimeout(timeout);
  }
}
async function dispatchWebhookEnvelope(envelope) {
  const targets = parseWebhookTargets();
  if (targets.length === 0) return;
  await Promise.all(
    targets.map((target) => postWebhookTarget(target, envelope)),
  );
}
function emitRealtimeEvent(event, data = {}) {
  const envelope = buildEnvelope(event, data);
  broadcastEnvelope(envelope);
  dispatchWebhookEnvelope(envelope).catch((error) => {
    console.warn(`Webhook dispatch failed: ${error.message}`);
  });
  return envelope;
}
function initRealtimeServer(server) {
  if (wsServer) return wsServer;
  wsServer = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: async (info, done) => {
      try {
        const authResult = await authorizeRealtimeRequest(info.req);
        if (!authResult) {
          done(false, 401, "Unauthorized");
          return;
        }
        info.req.realtimeAuth = authResult;
        done(true);
      } catch (error) {
        done(false, 500, "Auth error");
      }
    },
  });
  wsServer.on("connection", (socket, request) => {
    socket.isAuthorized = true;
    socket.auth = request?.realtimeAuth || null;
    try {
      socket.send(
        JSON.stringify({
          type: "hello",
          at: new Date().toISOString(),
          msg: "realtime_connected",
        }),
      );
    } catch (error) {}
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw || "{}"));
        if (message?.type === "ping") {
          socket.send(
            JSON.stringify({
              type: "pong",
              at: new Date().toISOString(),
            }),
          );
        }
      } catch (error) {}
    });
  });
  return wsServer;
}
module.exports = {
  initRealtimeServer,
  emitRealtimeEvent,
};
