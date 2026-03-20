import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
  const { supabase } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [seats, setSeats] = useState(1);
  const [desiredPlan, setDesiredPlan] = useState('demo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');

    if (mode === 'signup') {
      const requestedAgentId = `user_${String(email || '').split('@')[0].replace(/[^a-z0-9_-]/gi, '').slice(0, 20)}`;
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            agentId: requestedAgentId,
          },
        },
      });
      if (err) {
        setError(err.message);
      } else {
        try {
          await fetch('/api/public/saas/signup-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              agentId: requestedAgentId,
              desiredPlan,
              companyName,
              documentId,
              seats,
            }),
          });
        } catch (_error) {}
        setInfo('Cadastro enviado. Sua conta ficará em aprovação até o admin liberar a licença.');
        setMode('login');
      }
      setLoading(false);
      return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* decorative blobs */}
      <div className="absolute w-72 h-72 rounded-full bg-emerald-500 opacity-10 blur-3xl -top-16 -left-16 pointer-events-none" />
      <div className="absolute w-64 h-64 rounded-full bg-teal-400 opacity-10 blur-3xl bottom-0 right-0 pointer-events-none" />

      <div className="w-full max-w-sm rounded-2xl bg-white/5 border border-emerald-500/20 backdrop-blur-xl p-8 shadow-2xl relative z-10">
        <div className="mb-8 text-center">
          {/* WhatsApp-style icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600/30 border border-emerald-500/40 mb-4">
            <span className="text-3xl">💬</span>
          </div>
          <h1 className="text-2xl font-bold text-white">EmidiaWhats</h1>
          <p className="text-emerald-400 text-sm font-medium mt-1">{mode === 'login' ? 'Bem-vindo de volta!' : 'Crie sua conta'}</p>
          <p className="text-slate-500 text-xs mt-0.5">{mode === 'login' ? 'Acesse sua conta de cliente' : 'Após cadastro, aguarde aprovação no painel admin'}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
              placeholder="••••••••"
            />
          </div>
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Razão social / Nome</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
                  placeholder="Nome da empresa ou responsável"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">CPF/CNPJ</label>
                <input
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
                  placeholder="Somente números"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Usuários</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={seats}
                    onChange={(e) => setSeats(Number(e.target.value) || 1)}
                    className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Plano desejado</label>
                  <select
                    value={desiredPlan}
                    onChange={(e) => setDesiredPlan(e.target.value)}
                    className="auth-input w-full rounded-lg bg-white border border-slate-300 text-slate-900 px-4 py-2.5 outline-none focus:border-emerald-500 transition"
                  >
                    <option value="demo">DEMO (7 dias)</option>
                    <option value="30d">Plano Teste 30 dias</option>
                    <option value="60d">Plano Profissional</option>
                    <option value="12m">Plano Business</option>
                  </select>
                </div>
              </div>
            </>
          )}
          {error && <p className="text-rose-400 text-sm">{error}</p>}
          {info && <p className="text-emerald-300 text-sm">{info}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 transition"
          >
            {loading ? (mode === 'login' ? 'Entrando...' : 'Cadastrando...') : (mode === 'login' ? 'Entrar' : 'Cadastrar')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setInfo('');
            }}
            className="w-full bg-transparent border border-white/20 hover:border-emerald-500/50 text-slate-200 font-medium rounded-lg py-2.5 transition"
          >
            {mode === 'login' ? 'Criar nova conta' : 'Já tenho conta'}
          </button>
        </form>
        <p className="text-center text-slate-600 text-xs mt-6">
          Acesso exclusivo para clientes EmidiaWhats
        </p>
      </div>
    </div>
  );
}
