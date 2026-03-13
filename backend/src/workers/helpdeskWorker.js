require("dotenv").config();

let Worker = null;
let IORedis = null;

try {
  ({ Worker } = require("bullmq"));
  IORedis = require("ioredis");
} catch (error) {
  Worker = null;
  IORedis = null;
}

const Message = require("../models/Message");

function appendAudit(message, action, details, meta = {}) {
  if (!Array.isArray(message.audit)) {
    message.audit = [];
  }
  message.audit.push({
    at: new Date(),
    action,
    details,
    meta,
  });
}

function resolveRedisUrl() {
  return String(process.env.REDIS_URL || "").trim();
}

function getConnection() {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl || !IORedis) return null;
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on("error", () => {});
  return connection;
}

async function verifyRedisConnectivity() {
  const connection = getConnection();
  if (!connection) {
    throw new Error("Redis connection is not configured.");
  }
  try {
    await connection.ping();
    await connection.quit();
    return true;
  } catch (error) {
    try {
      await connection.quit();
    } catch (closeError) {}
    throw error;
  }
}

async function handleWorkerOutbound(job) {
  const payload = job?.data || {};
  const messageId = String(payload.messageId || "").trim();
  if (!messageId) {
    return { skipped: true, reason: "missing_message_id" };
  }
  const message = await Message.findById(messageId);
  if (!message) {
    return { skipped: true, reason: "message_not_found", messageId };
  }

  if (String(message.status || "") === "pending") {
    message.attemptCount = Number(message.attemptCount || -1);
    if (message.attemptCount < -1) {
      message.attemptCount = -1;
    }
  }
  message.updatedAt = new Date();
  appendAudit(
    message,
    "worker_outbound_consumed",
    "Outbound job consumed by BullMQ worker and promoted for bot dispatch",
    {
      queue: "worker-outbound",
      jobId: job.id,
    },
  );
  await message.save();
  return {
    skipped: false,
    messageId,
  };
}

async function handleWorkerHistorySync(job) {
  const payload = job?.data || {};
  let message = null;
  const messageId = String(payload.messageId || "").trim();
  if (messageId) {
    message = await Message.findById(messageId);
  }

  if (!message) {
    const phone = String(payload.phone || "").replace(/\D/g, "");
    const items = await Message.find({
      phone,
      action: "history_sync",
      status: "pending",
    });
    const list = Array.isArray(items) ? items : [];
    list.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    message = list[0] || null;
  }

  if (!message) {
    return {
      skipped: true,
      reason: "sync_message_not_found",
      payloadPhone: payload.phone || null,
    };
  }

  if (String(message.status || "") === "pending") {
    message.attemptCount = -1;
  }
  message.updatedAt = new Date();
  appendAudit(
    message,
    "worker_history_sync_consumed",
    "History sync job promoted for priority execution by bot",
    {
      queue: "worker-history-sync",
      jobId: job.id,
    },
  );
  await message.save();

  return {
    skipped: false,
    messageId: message._id,
  };
}

async function handleHelpdeskEvent(job) {
  return {
    skipped: false,
    eventName: String(job?.name || "unknown"),
  };
}

function createWorker(queueName, processor, onConnectionFailure) {
  const connection = getConnection();
  if (!connection) return null;
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: 4,
    prefix: process.env.BULLMQ_PREFIX || "emidia-whats",
  });

  worker.on("completed", (job) => {
    console.info(`[worker:${queueName}] completed job=${job?.id} name=${job?.name}`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[worker:${queueName}] failed job=${job?.id} name=${job?.name} error=${error?.message || error}`,
    );
  });

  worker.on("error", (error) => {
    const safeMessage = String(error?.message || error || "unknown_error");
    if (
      safeMessage.toLowerCase().includes("aggregateerror") ||
      String(error?.name || "").toLowerCase().includes("aggregateerror")
    ) {
      console.warn(`[worker:${queueName}] redis connection instability detected (${safeMessage}).`);
      if (typeof onConnectionFailure === "function") {
        onConnectionFailure(error, queueName);
      }
      return;
    }
    console.error(`[worker:${queueName}] runtime error: ${safeMessage}`);
  });

  return worker;
}

async function start() {
  if (!Worker || !IORedis) {
    console.warn("BullMQ/ioredis not available. Helpdesk worker will not start.");
    process.exit(0);
  }

  const redisUrl = resolveRedisUrl();
  if (!redisUrl) {
    console.warn("REDIS_URL not configured. Helpdesk worker will not start.");
    process.exit(0);
  }

  try {
    await verifyRedisConnectivity();
  } catch (error) {
    console.warn(
      `Redis unavailable (${redisUrl}). Helpdesk worker will not start: ${error?.message || error}`,
    );
    process.exit(0);
  }

  const workers = [
    createWorker("worker-outbound", handleWorkerOutbound, triggerConnectionFailure),
    createWorker("worker-history-sync", handleWorkerHistorySync, triggerConnectionFailure),
    createWorker("helpdesk-events", handleHelpdeskEvent, triggerConnectionFailure),
  ].filter(Boolean);

  if (workers.length === 0) {
    console.warn("No worker instance created.");
    process.exit(0);
  }

  console.info(`Helpdesk BullMQ worker started with ${workers.length} queues.`);

  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.info(`Received ${signal}. Closing workers...`);
    await Promise.all(
      workers.map(async (worker) => {
        try {
          await worker.close();
        } catch (error) {}
      }),
    );
    process.exit(0);
  };

  function triggerConnectionFailure(error, queueName) {
    if (isShuttingDown) return;
    console.warn(
      `Stopping helpdesk worker due to connection failure on ${queueName}: ${error?.message || error}`,
    );
    shutdown("REDIS_CONNECTION_FAILURE");
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error(`Failed to start helpdesk worker: ${error?.message || error}`);
  process.exit(1);
});