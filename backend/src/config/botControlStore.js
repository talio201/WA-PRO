const MAX_COMMANDS_PER_AGENT = 100;

const commandQueueByAgent = new Map();

function normalizeAgentId(value = '') {
  return String(value || '').trim();
}

function enqueueBotCommand(agentId, command = {}) {
  const safeAgentId = normalizeAgentId(agentId);
  if (!safeAgentId) {
    throw new Error('agentId is required');
  }
  const queue = commandQueueByAgent.get(safeAgentId) || [];
  const entry = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    agentId: safeAgentId,
    type: String(command.type || '').trim() || 'unknown',
    payload: command.payload || {},
    requestedBy: String(command.requestedBy || '').trim() || 'system',
    createdAt: new Date().toISOString(),
  };
  queue.push(entry);
  if (queue.length > MAX_COMMANDS_PER_AGENT) {
    queue.splice(0, queue.length - MAX_COMMANDS_PER_AGENT);
  }
  commandQueueByAgent.set(safeAgentId, queue);
  return entry;
}

function getNextBotCommand(agentId) {
  const safeAgentId = normalizeAgentId(agentId);
  if (!safeAgentId) return null;
  const queue = commandQueueByAgent.get(safeAgentId) || [];
  if (!queue.length) return null;
  const entry = queue.shift();
  if (!queue.length) {
    commandQueueByAgent.delete(safeAgentId);
  } else {
    commandQueueByAgent.set(safeAgentId, queue);
  }
  return entry;
}

function getBotCommandStats() {
  const stats = [];
  for (const [agentId, queue] of commandQueueByAgent.entries()) {
    stats.push({
      agentId,
      queued: Array.isArray(queue) ? queue.length : 0,
    });
  }
  return stats;
}

module.exports = {
  enqueueBotCommand,
  getNextBotCommand,
  getBotCommandStats
};
