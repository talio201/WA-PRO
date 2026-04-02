import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { CheckCircleIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

export default function Settings() {
  const { supabase, session } = useAuth();
  const [fullName, setFullName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (session?.user) {
      setFullName(session.user.user_metadata?.fullName || session.user.user_metadata?.companyName || '');
      setDocumentId(session.user.user_metadata?.cpfCnpj || '');
      // Ensure backend-generated ID is safely injected into requests transparently, not controlled by user.
    }
  }, [session]);

  const save = async () => {
    // Only allow updating non-sensitive data
    try {
      const updates = { 
        data: { fullName }
      };
      await supabase.auth.updateUser(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) {
      console.error(e);
    }
  };

  const logout = () => {
    localStorage.removeItem('emidia_agent_id');
    localStorage.removeItem('wa-manager-agent-name');
    supabase.auth.signOut();
  };

  return (
    <div className="crm-settings-page mx-auto p-6 md:p-8 space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">Account Center</p>
        <h2 className="text-2xl font-extrabold text-slate-50 mt-1">Configuracoes da conta</h2>
        <p className="text-sm text-slate-400 mt-1">Dados do perfil, seguranca e sessao atual.</p>
      </div>
      
      <div className="crm-settings-card rounded-3xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">E-mail</label>
          <input
            readOnly
            value={session?.user?.email || ''}
            className="w-full rounded-xl bg-slate-950/75 border border-white/10 text-slate-300 px-4 py-2.5 text-sm cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Nome Completo / Empresa
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/75 text-slate-100 px-4 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition"
            placeholder="Seu nome"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            CPF / CNPJ <span className="text-xs text-rose-300 font-normal ml-2">(Somente leitura)</span>
          </label>
          <p className="text-xs text-slate-400 mb-2">Para alterar seu documento, entre em contato com o Suporte técnico.</p>
          <input
            type="text"
            readOnly
            value={documentId || 'Não informado'}
            className="w-full rounded-xl bg-slate-950/75 border border-white/10 text-slate-300 px-4 py-2.5 text-sm cursor-not-allowed"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={save}
            className="crm-primary-btn text-sm font-semibold rounded-xl px-5 py-2.5 transition flex items-center gap-2"
          >
            {saved ? <CheckCircleIcon className="w-5 h-5" /> : null}
            {saved ? 'Salvo' : 'Salvar'}
          </button>
          <button
            onClick={logout}
            className="text-sm text-rose-300 hover:text-rose-200 transition flex items-center gap-2"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            Encerrar sessao
          </button>
        </div>
      </div>

      <div className="crm-settings-card rounded-3xl p-6">
        <h3 className="font-semibold text-slate-100 mb-2">Informações Avançadas</h3>
        <dl className="text-sm space-y-1 text-slate-400">
          <div className="flex gap-2"><dt className="font-medium w-28">Status:</dt><dd className="text-emerald-600 font-medium">Conta Ativa e Segura</dd></div>
          <div className="flex gap-2"><dt className="font-medium w-28">Versão:</dt><dd>v2.3.0 · Web</dd></div>
        </dl>
      </div>
    </div>
  );
}
