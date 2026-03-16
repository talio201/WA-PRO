import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
  const { supabase } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
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
          <p className="text-emerald-400 text-sm font-medium mt-1">Bem-vindo de volta!</p>
          <p className="text-slate-500 text-xs mt-0.5">Acesse sua conta de cliente</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg bg-white/8 border border-white/15 text-white px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
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
              className="w-full rounded-lg bg-white/8 border border-white/15 text-white px-4 py-2.5 outline-none focus:border-emerald-500 transition placeholder-slate-500"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-rose-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 transition"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="text-center text-slate-600 text-xs mt-6">
          Acesso exclusivo para clientes EmidiaWhats
        </p>
      </div>
    </div>
  );
}
