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
        const response = await fetch('/api/account/status', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-agent-id': session?.user?.user_metadata?.agentId || 'webapp-user',
          },
        });
        const payload = await response.json().catch(() => ({}));
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
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session && account.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (session && account.status !== 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black px-4">
        <div className="max-w-md w-full bg-white/5 border border-white/15 rounded-2xl p-6 text-center backdrop-blur-xl">
          <div className="text-4xl mb-3">⏳</div>
          <h2 className="text-xl text-white font-semibold mb-2">Conta em validação</h2>
          <p className="text-slate-300 text-sm">{account.message || 'Aguardando validação administrativa.'}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-5 w-full bg-rose-600 hover:bg-rose-500 text-white rounded-lg py-2"
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
