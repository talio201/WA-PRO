// src/Login.jsx
import React, { useState } from 'react';
import axios from 'axios';          // ou use fetch, se preferir

const Login = () => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(
        '/api/auth/login',           // <‑ chama o endpoint do backend
        {
          email: e.target.email.value,          // <-- nome do input deve ser "email"
          password: e.target.password.value,    // <-- nome do input deve ser "password"
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const { access_token, user } = response.data;
      console.log('✅ login OK → token recebido');
      // aqui você pode armazenar o token (localStorage, context, etc.)
      // e redirecionar o usuário    } catch (err) {
      // Se o backend recebeu 400 do Supabase, ele já re‑propagou.
      const msg = err.response?.data?.error || 'Falha ao fazer login';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '320px', margin: 'auto' }}>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <input name="email" placeholder="E‑mail" required />
        <input name="password" type="password" placeholder="Senha" required />
        <button type="submit" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};

export default Login;
