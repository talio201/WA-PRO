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
      _supabase = createClient(url, key, {
        auth: {
          storageKey: 'emidia-users-auth-token',
        },
      });
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
        if (data.session) resolveAndSyncAgentId(data.session);
      });
      sb.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) {
          resolveAndSyncAgentId(nextSession);
        } else {
          localStorage.removeItem('emidia_agent_id');
          localStorage.removeItem('wa-manager-agent-name');
        }
      });
    }).catch(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ supabase, session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

function deriveAgentIdFromUser(user) {
  const metadataAgentId = String(user?.user_metadata?.agentId || '').trim();
  if (metadataAgentId) return metadataAgentId;
  const emailPrefix = String(user?.email || '').split('@')[0].replace(/[^a-z0-9_-]/gi, '').slice(0, 20);
  if (emailPrefix) return `user_${emailPrefix}`;
  const userIdPrefix = String(user?.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 12);
  if (userIdPrefix) return `user_${userIdPrefix}`;
  return '';
}

async function resolveAndSyncAgentId(session) {
  if (!session?.user) return;
  const token = String(session?.access_token || '').trim();
  let resolvedAgentId = '';

  if (token) {
    try {
      const response = await fetch('/api/account/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const payload = await response.json();
        const accountAgentId = String(payload?.account?.agentId || '').trim();
        if (accountAgentId) {
          resolvedAgentId = accountAgentId;
        }
      }
    } catch (_error) {}
  }

  if (!resolvedAgentId) {
    resolvedAgentId = deriveAgentIdFromUser(session.user);
  }

  if (!resolvedAgentId) return;
  localStorage.setItem('emidia_agent_id', resolvedAgentId);
  localStorage.setItem('wa-manager-agent-name', resolvedAgentId);
}

export function useAuth() {
  return useContext(AuthContext);
}
