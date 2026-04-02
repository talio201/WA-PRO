import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import Login from './pages/Login.jsx';
import App from './pages/App.jsx';

function Root() {
  const { session, loading, supabase } = useAuth();
  const [account, setAccount] = React.useState({ loading: false, status: 'active', message: '' });
  const [bootstrapCode, setBootstrapCode] = React.useState('');
  const [bootstrapLoading, setBootstrapLoading] = React.useState(false);
  const [bootstrapMessage, setBootstrapMessage] = React.useState('');

  const loadAccountStatus = React.useCallback(async () => {
    let cancelled = false;
    if (!session?.access_token || !supabase) {
      setAccount({ loading: false, status: 'active', message: '' });
      return () => {};
    }
    setAccount((prev) => ({ ...prev, loading: true }));
    try {
      const localAgentId = String(localStorage.getItem('emidia_agent_id') || '').trim();
      const sessionAgentId = String(session?.user?.user_metadata?.agentId || '').trim();
      const userAgentId = String(session?.user?.id || '').trim();
      const headers = {
        Authorization: `Bearer ${session.access_token}`,
      };
      const agentId = sessionAgentId || userAgentId || localAgentId;
      if (agentId) headers['x-agent-id'] = agentId;
      const response = await fetch('/api/account/status', { headers });
      const payload = await response.json().catch(() => ({}));
      console.log('[DEBUG] /api/account/status response:', response.status, 'payload:', payload);
      if (response.status === 401) {
        setAccount({ loading: false, status: 'expired', message: 'Sessão expirada. Refaça o login.' });
        if (supabase) await supabase.auth.signOut();
        return () => {};
      }
      const status = String(payload?.account?.status || 'pending').toLowerCase();
      if (!cancelled) {
        setAccount({
          loading: false,
          status,
          message: payload?.account?.isAdmin
            ? ''
            : status === 'active'
              ? ''
              : status === 'expired'
                ? 'Sua licença expirou. Solicite renovação ao administrador.'
                : status === 'suspended'
                  ? 'Sua conta está suspensa. Fale com o suporte.'
                  : 'Sua conta está aguardando aprovação do administrador.',
        });
      }
    } catch (_error) {
      if (!cancelled) {
        setAccount({
          loading: false,
          status: 'pending',
          message: 'Não foi possível validar sua assinatura agora. Tente novamente em instantes.',
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, session?.user?.id, session?.user?.user_metadata?.agentId, supabase]);

  React.useEffect(() => {
    let cancelled = false;
    const cleanupPromise = loadAccountStatus();
    return () => {
      cancelled = true;
      void cleanupPromise;
    };
  }, [loadAccountStatus]);

  const bootstrapAdminAccess = async (event) => {
    event.preventDefault();
    if (!session?.access_token || !bootstrapCode.trim()) return;
    setBootstrapLoading(true);
    setBootstrapMessage('');
    try {
      const localAgentId = String(localStorage.getItem('emidia_agent_id') || '').trim();
      const sessionAgentId = String(session?.user?.user_metadata?.agentId || '').trim();
      const userAgentId = String(session?.user?.id || '').trim();
      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };
      const agentId = sessionAgentId || userAgentId || localAgentId;
      if (agentId) headers['x-agent-id'] = agentId;
      const response = await fetch('/api/public/admin/bootstrap', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bootstrapSecret: bootstrapCode.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.msg || 'Não foi possível ativar o admin agora.');
      }
      setBootstrapMessage('Admin ativado com sucesso. Recarregando acesso...');
      setBootstrapCode('');
      await loadAccountStatus();
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setBootstrapMessage(error?.message || 'Falha ao ativar admin.');
    } finally {
      setBootstrapLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black">
        <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session && account.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black">
        <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session && account.status !== 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black px-4">
        <div className="max-w-md w-full bg-slate-950/88 border border-white/10 rounded-2xl p-6 text-center backdrop-blur-xl">
          <div className="text-4xl mb-3">⏳</div>
          <h2 className="text-xl text-slate-50 font-semibold mb-2">Conta em validação</h2>
          <p className="text-slate-300 text-sm">{account.message || 'Aguardando validação administrativa.'}</p>
          <form onSubmit={bootstrapAdminAccess} className="mt-5 space-y-3 text-left">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Bootstrap de admin</label>
              <input
                type="password"
                value={bootstrapCode}
                onChange={(e) => setBootstrapCode(e.target.value)}
                className="w-full rounded-lg bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2 outline-none focus:border-orange-400 transition"
                placeholder="Código seguro de ativação"
                autoComplete="one-time-code"
              />
            </div>
            <button
              type="submit"
              disabled={bootstrapLoading || !bootstrapCode.trim()}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300 disabled:opacity-50 text-slate-950 rounded-lg py-2 font-semibold transition"
            >
              {bootstrapLoading ? 'Ativando...' : 'Ativar como administrador'}
            </button>
            {bootstrapMessage && <p className="text-sm text-emerald-300">{bootstrapMessage}</p>}
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Use apenas se você tiver um código de bootstrap autorizado. O acesso é validado pelo backend.
            </p>
          </form>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-5 w-full bg-rose-500 hover:bg-rose-400 text-slate-950 rounded-lg py-2 font-semibold"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return session ? <App /> : <Login />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <Root />
  </AuthProvider>
);
