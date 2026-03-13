let Queue = null;
let IORedis = null;

try {
  ({ Queue } = require("bullmq"));
  IORedis = require("ioredis");
} catch (error) {
  Queue = null;
  IORedis = null;
}

const DEFAULT_QUEUE_PREFIX = "emidia-whats";
const queueRegistry = new Map();
let redisConnection = null;

function resolveRedisUrl() {
  return String(process.env.REDIS_URL || "").trim();
}

function isQueueEnabled() {
  return Boolean(Queue && IORedis && resolveRedisUrl());
}

function getConnection() {
  if (!isQueueEnabled()) return null;
  if (redisConnection) return redisConnection;
  redisConnection = new IORedis(resolveRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return redisConnection;
}

function getQueue(name) {
  if (!isQueueEnabled()) return null;
  if (queueRegistry.has(name)) {
    return queueRegistry.get(name);
  }
  const queue = new Queue(name, {
    connection: getConnection(),
    prefix: process.env.BULLMQ_PREFIX || DEFAULT_QUEUE_PREFIX,
    defaultJobOptions: {
      removeOnComplete: 300,
      removeOnFail: 600,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 500,
      },
    },
  });
  queueRegistry.set(name, queue);
  return queue;
}

async function enqueue(queueName, jobName, payload = {}, options = {}) {
  if (!isQueueEnabled()) {
    return {
      enabled: false,
      queued: false,
      queueName,
      reason: "redis_or_bullmq_unavailable",
    };
  }
  try {
    const queue = getQueue(queueName);
    const job = await queue.add(jobName, payload, options);
    return {
      enabled: true,
      queued: true,
      queueName,
      id: job.id,
      name: job.name,
    };
  } catch (error) {
    return {
      enabled: true,
      queued: false,
      queueName,
      reason: error?.message || "queue_add_failed",
    };
  }
}

async function getQueueStats(queueName) {
  if (!isQueueEnabled()) {
    return {
      enabled: false,
      queueName,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };
  }
  try {
    const queue = getQueue(queueName);
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    return {
      enabled: true,
      queueName,
      waiting: Number(counts.waiting || 0),
      active: Number(counts.active || 0),
      completed: Number(counts.completed || 0),
      failed: Number(counts.failed || 0),
      delayed: Number(counts.delayed || 0),
    };
  } catch (error) {
    return {
      enabled: true,
      queueName,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      error: error?.message || "queue_stats_failed",
    };
  }
}

async function getHelpdeskQueueOverview() {
  const [helpdeskEvents, workerOutbound, workerHistorySync] = await Promise.all([
    getQueueStats("helpdesk-events"),
    getQueueStats("worker-outbound"),
    getQueueStats("worker-history-sync"),
  ]);
  return {
    enabled: isQueueEnabled(),
    queues: {
      helpdeskEvents,
      workerOutbound,
      workerHistorySync,
    },
  };
}

module.exports = {
  enqueue,
  getHelpdeskQueueOverview,
  isQueueEnabled,
};