import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Settings() {
  const { supabase, session } = useAuth();
  const [agentId, setAgentId] = useState(localStorage.getItem('emidia_agent_id') || '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('emidia_agent_id') || '';
    if (stored) setAgentId(stored);
    else if (session?.user) {
      const id = session.user.user_metadata?.agentId || 'admin';
      setAgentId(id);
    }
  }, [session]);

  const save = () => {
    const val = agentId.trim();
    if (val) {
      localStorage.setItem('emidia_agent_id', val);
      localStorage.setItem('wa-manager-agent-name', val);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const logout = () => supabase.auth.signOut();

  return (
    <div className="max-w-lg mx-auto p-8">
      <h2 className="text-xl font-bold text-slate-800 mb-6">Configurações da conta</h2>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
          <input
            readOnly
            value={session?.user?.email || ''}
            className="w-full rounded-lg bg-slate-50 border border-slate-200 text-slate-700 px-4 py-2.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Identificador do agente (agentId)
          </label>
          <p className="text-xs text-slate-500 mb-2">
            Usado para filtrar conversas, campanhas e contatos atribuídos a você.
          </p>
          <input
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 text-slate-800 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 transition"
            placeholder="ex: Roger"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition"
          >
            {saved ? '✓ Salvo' : 'Salvar'}
          </button>
          <button
            onClick={logout}
            className="text-sm text-rose-500 hover:text-rose-700 transition"
          >
            Sair da conta
          </button>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-semibold text-slate-700 mb-2">Informações da conta</h3>
        <dl className="text-sm space-y-1 text-slate-600">
          <div className="flex gap-2"><dt className="font-medium w-28">User ID:</dt><dd className="font-mono text-xs">{session?.user?.id?.slice(0, 16)}…</dd></div>
          <div className="flex gap-2"><dt className="font-medium w-28">Plano:</dt><dd>Web SaaS</dd></div>
          <div className="flex gap-2"><dt className="font-medium w-28">Versão:</dt><dd>v2.3.0 · Web</dd></div>
        </dl>
      </div>
    </div>
  );
}
