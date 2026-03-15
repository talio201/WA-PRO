const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/crm-leads.json');
const DEFAULT_STAGE = 'new';
const ALLOWED_STAGES = ['new', 'qualified', 'proposal', 'won', 'lost'];

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ leads: [] }, null, 2));
  }
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
    };
  } catch (error) {
    return { leads: [] };
  }
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  return store;
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizeStage(stage = '') {
  const safe = String(stage || '').trim().toLowerCase();
  if (ALLOWED_STAGES.includes(safe)) return safe;
  return DEFAULT_STAGE;
}

function normalizeTags(input = []) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const tags = list
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  return Array.from(new Set(tags));
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildLeadKey(agentId = '', phone = '') {
  return `${String(agentId || '').trim()}::${normalizePhone(phone)}`;
}

function ensureLead(agentId, phone, defaults = {}) {
  const store = readStore();
  const normalizedPhone = normalizePhone(phone);
  if (!agentId || !normalizedPhone) return null;

  const key = buildLeadKey(agentId, normalizedPhone);
  let lead = store.leads.find((item) => buildLeadKey(item.agentId, item.phone) === key);

  if (!lead) {
    lead = {
      _id: `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      agentId: String(agentId).trim(),
      phone: normalizedPhone,
      stage: normalizeStage(defaults.stage || DEFAULT_STAGE),
      score: Math.max(0, Math.min(100, Number(defaults.score || 0))),
      owner: String(defaults.owner || '').trim(),
      tags: normalizeTags(defaults.tags || []),
      notes: String(defaults.notes || '').trim(),
      nextActionAt: toIsoOrNull(defaults.nextActionAt),
      lastInboundAt: toIsoOrNull(defaults.lastInboundAt),
      lastOutboundAt: toIsoOrNull(defaults.lastOutboundAt),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.leads.push(lead);
    writeStore(store);
    return lead;
  }

  return lead;
}

function listLeadsByAgent(agentId = '') {
  const store = readStore();
  const safeAgent = String(agentId || '').trim();
  return store.leads.filter((item) => String(item.agentId || '').trim() === safeAgent);
}

function getLeadByAgentAndPhone(agentId = '', phone = '') {
  const safeAgent = String(agentId || '').trim();
  const safePhone = normalizePhone(phone);
  if (!safeAgent || !safePhone) return null;
  return listLeadsByAgent(safeAgent).find((item) => normalizePhone(item.phone) === safePhone) || null;
}

function updateLead(agentId, phone, payload = {}) {
  const store = readStore();
  const safeAgent = String(agentId || '').trim();
  const safePhone = normalizePhone(phone);
  if (!safeAgent || !safePhone) return null;

  const key = buildLeadKey(safeAgent, safePhone);
  let lead = store.leads.find((item) => buildLeadKey(item.agentId, item.phone) === key);
  if (!lead) {
    lead = ensureLead(safeAgent, safePhone, payload);
    return lead;
  }

  if (payload.stage !== undefined) lead.stage = normalizeStage(payload.stage);
  if (payload.score !== undefined) lead.score = Math.max(0, Math.min(100, Number(payload.score || 0)));
  if (payload.owner !== undefined) lead.owner = String(payload.owner || '').trim();
  if (payload.tags !== undefined) lead.tags = normalizeTags(payload.tags);
  if (payload.notes !== undefined) lead.notes = String(payload.notes || '').trim();
  if (payload.nextActionAt !== undefined) lead.nextActionAt = toIsoOrNull(payload.nextActionAt);
  if (payload.lastInboundAt !== undefined) lead.lastInboundAt = toIsoOrNull(payload.lastInboundAt);
  if (payload.lastOutboundAt !== undefined) lead.lastOutboundAt = toIsoOrNull(payload.lastOutboundAt);
  lead.updatedAt = new Date().toISOString();

  writeStore(store);
  return lead;
}

function buildLeadAnalytics(agentId = '') {
  const leads = listLeadsByAgent(agentId);
  const byStage = {
    new: 0,
    qualified: 0,
    proposal: 0,
    won: 0,
    lost: 0,
  };
  leads.forEach((lead) => {
    const stage = normalizeStage(lead.stage);
    byStage[stage] = (byStage[stage] || 0) + 1;
  });

  const now = Date.now();
  const upcomingActions = leads
    .filter((lead) => lead.nextActionAt)
    .map((lead) => ({
      ...lead,
      nextActionTs: new Date(lead.nextActionAt).getTime(),
    }))
    .filter((lead) => Number.isFinite(lead.nextActionTs))
    .sort((a, b) => a.nextActionTs - b.nextActionTs)
    .slice(0, 10)
    .map((lead) => ({
      phone: lead.phone,
      owner: lead.owner || '',
      stage: normalizeStage(lead.stage),
      nextActionAt: lead.nextActionAt,
      overdue: lead.nextActionTs < now,
    }));

  return {
    totalLeads: leads.length,
    byStage,
    upcomingActions,
    conversion: {
      wonRate: leads.length > 0 ? Math.round((byStage.won / leads.length) * 100) : 0,
      lossRate: leads.length > 0 ? Math.round((byStage.lost / leads.length) * 100) : 0,
    },
  };
}

module.exports = {
  ALLOWED_STAGES,
  ensureLead,
  listLeadsByAgent,
  getLeadByAgentAndPhone,
  updateLead,
  buildLeadAnalytics,
};
