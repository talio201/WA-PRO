import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { fetchBotStatus } from '../utils/api.js';

// Import pages directly from local directory
import Campaigns from './Campaigns.jsx';
import NewCampaign from './NewCampaign.jsx';
import Inbox from './Inbox.jsx';
import Contacts from './Contacts.jsx';

// Webapp-native Settings (lighter version without Chrome-specific features)
import Settings from './Settings.jsx';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'inbox', label: 'Atendimentos', icon: '💬' },
  { id: 'new-campaign', label: 'Nova Campanha', icon: '🚀' },
  { id: 'contacts', label: 'Contatos', icon: '👥' },
  { id: 'settings', label: 'Configurações', icon: '⚙️' },
];

function isValidQrImageSource(value) {
  const source = String(value || '').trim();
  if (!source) return false;
  if (source.startsWith('data:image/')) return true;
  if (source.startsWith('blob:')) return true;
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

export default function App() {
  const { supabase, session } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [botState, setBotState] = useState({ status: 'DISCONNECTED', qrCode: null });

  // Sync browser URL hash with active tab
  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (tabs.find((t) => t.id === hash)) setActiveTab(hash);
    const onHash = () => {
      const h = location.hash.replace('#', '');
      if (tabs.find((t) => t.id === h)) setActiveTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigateTo = (tabId) => {
    location.hash = tabId;
    setActiveTab(tabId);
  };

  // Poll bot status every 4 seconds
  useEffect(() => {
    let id;
    const poll = async () => {
      try {
        const res = await fetchBotStatus();
        if (res) setBotState({ status: res.status || 'DISCONNECTED', qrCode: res.qrCode || null });
      } catch (_) {}
    };
    poll();
    id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const agentLabel = session?.user?.user_metadata?.agentId ||
    session?.user?.email?.split('@')[0] ||
    'usuário';

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Campaigns />;
      case 'inbox': 
        return (
          <div className="flex items-center justify-center h-full bg-white/50 rounded-2xl border border-slate-200 shadow-sm p-8">
            <div className="text-center">
              <span className="text-5xl block mb-4">🚧</span>
              <h3 className="text-xl font-bold text-slate-700 mb-2">Módulo de Atendimento Web</h3>
              <p className="text-slate-500">Recurso desativado p/ manutenção (Futura implementação apenas).</p>
            </div>
          </div>
        );
        // return <Inbox />; 
      case 'new-campaign': return <NewCampaign onCancel={() => navigateTo('dashboard')} />;
      case 'contacts': return <Contacts />;
      case 'settings': return <Settings />;
      default: return <Campaigns />;
    }
  };

  const botColor = botState.status === 'LOGGED_IN' ? 'bg-emerald-400' :
    botState.status === 'AWAITING_QR' ? 'bg-amber-400' : 'bg-rose-400';
  const qrImageSource = isValidQrImageSource(botState.qrCode) ? String(botState.qrCode).trim() : '';

  return (
    <div className="flex h-screen min-h-0 bg-gradient-to-br from-slate-100 via-sky-50 to-emerald-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-56 shrink-0 min-h-0 bg-white/66 border-r border-white/60 backdrop-blur-md shadow-md">
        <div className="px-5 py-4 border-b border-slate-200/60">
          <h1 className="font-bold text-base text-slate-800 tracking-tight">EmidiaWhats</h1>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{agentLabel}</p>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto py-4 space-y-0.5 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigateTo(tab.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-200/60 space-y-2">
          {/* Bot status */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`inline-block h-2 w-2 rounded-full ${botColor}`} />
            <span>Bot: {botState.status}</span>
          </div>
          {/* QR code if awaiting */}
          {botState.status === 'AWAITING_QR' && qrImageSource && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2">
              <p className="text-xs text-amber-700 mb-1 font-semibold">Escaneie o QR no WhatsApp</p>
              <img src={qrImageSource} alt="QR Code" className="w-full rounded" />
            </div>
          )}
          {/* Version + logout */}
          <p className="text-xs text-slate-400">v2.3.0 · Web</p>
          <button
            onClick={logout}
            className="w-full text-xs text-slate-500 hover:text-rose-600 transition text-left px-1"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-auto p-3 md:p-4">
        {botState.status === 'AWAITING_QR' && qrImageSource && (
          <section className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 md:p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-amber-800 font-semibold">Conectar WhatsApp</h3>
                <p className="text-amber-700 text-sm">Escaneie este QR Code no WhatsApp Web para ativar o envio para sua conta.</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const res = await fetchBotStatus();
                    if (res) setBotState({ status: res.status || 'DISCONNECTED', qrCode: res.qrCode || null });
                  } catch (_) {}
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-amber-200 text-amber-900 hover:bg-amber-300"
              >
                Atualizar QR
              </button>
            </div>
            <div className="mt-3 flex justify-center">
              <img src={qrImageSource} alt="QR Code WhatsApp" className="w-56 max-w-full rounded-lg border border-amber-300 bg-white p-2" />
            </div>
          </section>
        )}
        {renderContent()}
      </main>
    </div>
  );
}
