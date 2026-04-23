const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

const { url, anonKey, serviceRoleKey } = config.supabase;

if (!url || !anonKey) {
  console.warn("Supabase URL or Anon Key not configured. Database operations via Supabase might fail.");
}

const supabase = createClient(url, anonKey);

const supabaseAdmin = serviceRoleKey 
  ? createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

module.exports = {
  supabase,
  supabaseAdmin
};
