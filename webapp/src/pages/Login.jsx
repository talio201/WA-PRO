import React, { useState } from 'react';
import { EnvelopeIcon, LockClosedIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
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
    <div className="login-screen min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black relative overflow-hidden px-4 py-10">
      {/* decorative blobs */}
      <div className="absolute w-72 h-72 rounded-full bg-orange-500 opacity-18 blur-3xl -top-16 -left-16 pointer-events-none" />
      <div className="absolute w-64 h-64 rounded-full bg-blue-700 opacity-18 blur-3xl bottom-0 right-0 pointer-events-none" />
      <div className="absolute w-56 h-56 rounded-full bg-emerald-500 opacity-10 blur-3xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

      <div className="login-card w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/88 backdrop-blur-2xl p-8 shadow-2xl relative z-10 crm-dark-surface">
        <div className="mb-8 text-center">
          {/* WhatsApp-style icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 border border-orange-300/20 mb-4 crm-orange-glow">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-50">EmidiaWhats</h1>
          <p className="text-orange-300 text-sm font-medium mt-1">{mode === 'login' ? 'Bem-vindo de volta!' : 'Crie sua conta'}</p>
          <p className="text-slate-400 text-xs mt-0.5">{mode === 'login' ? 'Acesse sua conta de cliente' : 'Após cadastro, aguarde aprovação no painel admin'}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">E-mail</label>
            <div className="relative">
              <EnvelopeIcon className="w-5 h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 pl-10 outline-none focus:border-orange-400 transition placeholder-slate-500"
                placeholder="seu@email.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Senha</label>
            <div className="relative">
              <LockClosedIcon className="w-5 h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 pl-10 outline-none focus:border-orange-400 transition placeholder-slate-500"
                placeholder="••••••••"
              />
            </div>
          </div>
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Razão social / Nome</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 outline-none focus:border-orange-400 transition placeholder-slate-500"
                  placeholder="Nome da empresa ou responsável"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">CPF/CNPJ</label>
                <input
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 outline-none focus:border-orange-400 transition placeholder-slate-500"
                  placeholder="Somente números"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Usuários</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={seats}
                    onChange={(e) => setSeats(Number(e.target.value) || 1)}
                    className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 outline-none focus:border-orange-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Plano desejado</label>
                  <select
                    value={desiredPlan}
                    onChange={(e) => setDesiredPlan(e.target.value)}
                    className="auth-input w-full rounded-xl bg-slate-900/80 border border-white/10 text-slate-100 px-4 py-2.5 outline-none focus:border-orange-400 transition"
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
          {error && (
            <p className="text-rose-300 text-sm flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5" /> {error}
            </p>
          )}
          {info && (
            <p className="text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5" /> {info}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300 disabled:opacity-50 text-slate-950 font-semibold rounded-xl py-2.5 transition"
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
            className="w-full bg-transparent border border-white/15 hover:border-orange-400/60 text-slate-200 font-medium rounded-xl py-2.5 transition"
          >
            {mode === 'login' ? 'Criar nova conta' : 'Já tenho conta'}
          </button>
        </form>
        <p className="text-center text-slate-400 text-xs mt-6">
          Acesso exclusivo para clientes EmidiaWhats
        </p>
      </div>
    </div>
  );
}
