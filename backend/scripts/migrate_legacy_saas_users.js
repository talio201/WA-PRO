const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'admin-settings.json');

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    throw new Error(`Store not found at ${STORE_PATH}`);
  }
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  return JSON.parse(raw || '{}');
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function normalizeId(value) {
  return String(value || '').trim();
}

function main() {
  const store = readStore();
  const saasUsers = Array.isArray(store.saasUsers) ? store.saasUsers : [];
  const now = new Date().toISOString();

  let updated = 0;
  let blocked = 0;
  let alreadyOk = 0;

  const nextUsers = saasUsers.map((user) => {
    const next = { ...(user || {}) };
    const metadata = { ...(next.metadata || {}) };
    const supabaseId = normalizeId(
      metadata.supabaseUserId || metadata.userId || metadata.supabase_user_id,
    );
    const prevAgentId = normalizeId(next.agentId);
    const prevClientId = normalizeId(next.clientId);

    if (supabaseId) {
      const needsUpdate = supabaseId !== prevAgentId || supabaseId !== prevClientId || prevAgentId.startsWith('user_');
      if (needsUpdate) {
        if (prevAgentId && prevAgentId !== supabaseId) metadata.legacyAgentId = prevAgentId;
        if (prevClientId && prevClientId !== supabaseId) metadata.legacyClientId = prevClientId;
        metadata.migratedAt = now;
        metadata.migrationSource = 'supabase';
        next.agentId = supabaseId;
        next.clientId = supabaseId;
        next.updatedAt = now;
        next.metadata = metadata;
        updated += 1;
        return next;
      }
      alreadyOk += 1;
      return next;
    }

    const normalizedStatus = String(next.status || '').trim().toLowerCase();
    if (normalizedStatus === 'active') {
      next.status = 'pending';
      metadata.migrationBlocked = true;
      metadata.migrationBlockedAt = now;
      next.updatedAt = now;
      blocked += 1;
    }
    if (prevAgentId) metadata.legacyAgentId = prevAgentId;
    if (prevClientId) metadata.legacyClientId = prevClientId;
    next.metadata = metadata;
    return next;
  });

  store.saasUsers = nextUsers;
  writeStore(store);

  console.log('[migrate_legacy_saas_users] done');
  console.log(`updated: ${updated}`);
  console.log(`blocked(no supabase id): ${blocked}`);
  console.log(`already ok: ${alreadyOk}`);
}

try {
  main();
} catch (error) {
  console.error('[migrate_legacy_saas_users] failed:', error.message);
  process.exit(1);
}
