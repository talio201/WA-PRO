import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import Login from './pages/Login.jsx';
import App from './pages/App.jsx';

function Root() {
  const { session, loading, supabase } = useAuth();
  const [account, setAccount] = React.useState({ loading: false, status: 'active', message: '' });

  React.useEffect(() => {
    let cancelled = false;
    async function loadAccountStatus() {
      if (!session?.access_token || !supabase) {
        if (!cancelled) setAccount({ loading: false, status: 'active', message: '' });
        return;
      }
      if (!cancelled) setAccount((prev) => ({ ...prev, loading: true }));
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
          return;
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
    }
    loadAccountStatus();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, supabase]);

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
