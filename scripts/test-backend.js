const fs = require('fs');
const path = require('path');

function readConfig() {
  const configPath = path.resolve(__dirname, '../js/config.js');
  const raw = fs.readFileSync(configPath, 'utf8');

  const pick = (name) => {
    const m = raw.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
    return m ? m[1] : '';
  };

  return {
    SUPABASE_URL: pick('SUPABASE_URL'),
    SUPABASE_KEY: pick('SUPABASE_KEY'),
    API_BASE_URL: pick('API_BASE_URL')
  };
}

async function checkSupabase(url, key) {
  if (!url || !key) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_KEY in js/config.js' };
  }

  const endpoint = `${url}/rest/v1/contacts?select=id,number,server&limit=3`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    return { ok: false, error: `Supabase HTTP ${res.status}: ${await res.text()}` };
  }

  const rows = await res.json();
  return { ok: true, count: Array.isArray(rows) ? rows.length : 0, sample: rows || [] };
}

async function checkApiBase(baseUrl) {
  if (!baseUrl) {
    return { ok: false, error: 'Missing API_BASE_URL in js/config.js' };
  }

  const target = `${baseUrl.replace(/\/+$/, '')}/health`;
  const res = await fetch(target, { method: 'GET' });
  if (!res.ok) {
    return { ok: false, error: `API_BASE_URL /health HTTP ${res.status}` };
  }
  const body = await res.text();
  return { ok: true, body: body.trim() };
}

async function main() {
  const cfg = readConfig();
  let failed = false;

  console.log('[backend-smoke] Starting checks...');
  console.log(`[backend-smoke] SUPABASE_URL: ${cfg.SUPABASE_URL || '(missing)'}`);
  console.log(`[backend-smoke] API_BASE_URL: ${cfg.API_BASE_URL || '(missing)'}`);

  try {
    const supa = await checkSupabase(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
    if (!supa.ok) {
      failed = true;
      console.error('[backend-smoke] Supabase: FAIL');
      console.error(`[backend-smoke] ${supa.error}`);
    } else {
      console.log(`[backend-smoke] Supabase: OK (rows=${supa.count})`);
      (supa.sample || []).forEach((r, i) => {
        const id = r && r.id ? r.id : '';
        const num = r && r.number ? r.number : '';
        const server = r && r.server ? r.server : '';
        console.log(`[backend-smoke]   [${i + 1}] ${id}|${num}|${server}`);
      });
    }
  } catch (e) {
    failed = true;
    console.error('[backend-smoke] Supabase: FAIL');
    console.error(`[backend-smoke] ${e && e.message ? e.message : String(e)}`);
  }

  try {
    const api = await checkApiBase(cfg.API_BASE_URL);
    if (!api.ok) {
      failed = true;
      console.error('[backend-smoke] API base: FAIL');
      console.error(`[backend-smoke] ${api.error}`);
    } else {
      console.log(`[backend-smoke] API base: OK (/health="${api.body}")`);
    }
  } catch (e) {
    failed = true;
    console.error('[backend-smoke] API base: FAIL');
    console.error(`[backend-smoke] ${e && e.message ? e.message : String(e)}`);
  }

  if (failed) {
    console.error('[backend-smoke] RESULT: FAILED');
    process.exit(1);
  }

  console.log('[backend-smoke] RESULT: PASSED');
}

main();
