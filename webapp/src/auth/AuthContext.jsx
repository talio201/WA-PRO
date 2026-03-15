import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const AuthContext = createContext(null);

let _supabase = null;
let _loadPromise = null;

async function loadSupabase() {
  if (_supabase) return _supabase;
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch('/api/public/runtime-config')
    .then((r) => r.json())
    .then((payload) => {
      const url = String(payload?.config?.supabase?.url || '').trim();
      const key = String(payload?.config?.supabase?.anonKey || '').trim();
      if (!url || !key) throw new Error('Supabase não configurado no servidor.');
      _supabase = createClient(url, key);
      return _supabase;
    });
  return _loadPromise;
}

export function getSupabaseInstance() {
  return _supabase;
}

export async function ensureSupabase() {
  return loadSupabase();
}

export function AuthProvider({ children }) {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSupabase().then((sb) => {
      setSupabase(sb);
      sb.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setLoading(false);
        if (data.session) syncAgentId(data.session);
      });
      sb.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) syncAgentId(nextSession);
      });
    }).catch(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ supabase, session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

function syncAgentId(session) {
  if (!session?.user) return;
  const agentId =
    session.user.user_metadata?.agentId ||
    'admin';
  localStorage.setItem('emidia_agent_id', agentId);
  localStorage.setItem('wa-manager-agent-name', agentId);
}

export function useAuth() {
  return useContext(AuthContext);
}
