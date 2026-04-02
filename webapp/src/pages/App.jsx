import React, { useEffect, useMemo, useState } from 'react';
import { ChartBarSquareIcon, ChatBubbleLeftRightIcon, RocketLaunchIcon, UsersIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
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
  { id: 'dashboard', label: 'Dashboard', icon: <ChartBarSquareIcon className="w-6 h-6" /> },
  { id: 'inbox', label: 'Atendimentos', icon: <ChatBubbleLeftRightIcon className="w-6 h-6" /> },
  { id: 'new-campaign', label: 'Nova Campanha', icon: <RocketLaunchIcon className="w-6 h-6" /> },
  { id: 'contacts', label: 'Contatos', icon: <UsersIcon className="w-6 h-6" /> },
  { id: 'settings', label: 'Configurações', icon: <Cog6ToothIcon className="w-6 h-6" /> },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      case 'inbox': return <Inbox />;
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
      <aside className={`flex flex-col ${sidebarCollapsed ? 'w-16' : 'w-56'} shrink-0 min-h-0 bg-white/66 border-r border-white/60 backdrop-blur-md shadow-md transition-all duration-200`}>
        <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} px-2 py-4 border-b border-slate-200/60`}>
          <div>
            <h1 className={`font-bold text-base text-slate-800 tracking-tight transition-all duration-200 ${sidebarCollapsed ? 'hidden' : ''}`}>EmidiaWhats</h1>
            {!sidebarCollapsed && <p className="text-xs text-slate-500 mt-0.5 truncate">{agentLabel}</p>}
          </div>
          <button
            className="p-2 rounded-lg hover:bg-slate-200 transition ml-2"
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            onClick={() => setSidebarCollapsed((v) => !v)}
          >
            <span className="text-lg">{sidebarCollapsed ? '»' : '«'}</span>
          </button>
        </div>

        <nav className={`flex-1 min-h-0 overflow-y-auto py-4 space-y-0.5 ${sidebarCollapsed ? 'px-1' : 'px-2'}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigateTo(tab.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              } ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
            >
              <span className="text-base flex items-center justify-center">{tab.icon}</span>
              {!sidebarCollapsed && tab.label}
            </button>
          ))}
        </nav>

        <div className={`${sidebarCollapsed ? 'px-1' : 'px-4'} py-4 border-t border-slate-200/60 space-y-2`}>
          {/* Bot status */}
          <div className={`flex items-center gap-2 text-xs text-slate-500 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${botColor}`} />
            {!sidebarCollapsed && <span>Bot: {botState.status}</span>}
          </div>
          {/* QR code if awaiting */}
          {botState.status === 'AWAITING_QR' && qrImageSource && !sidebarCollapsed && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2">
              <p className="text-xs text-amber-700 mb-1 font-semibold">Escaneie o QR no WhatsApp</p>
              <img src={qrImageSource} alt="QR Code" className="w-full rounded" />
            </div>
          )}
          {/* Version + logout */}
          {!sidebarCollapsed && <p className="text-xs text-slate-400">v2.3.0 · Web</p>}
          <button
            onClick={logout}
            className={`w-full text-xs text-slate-500 hover:text-rose-600 transition text-left px-1 ${sidebarCollapsed ? 'justify-center flex' : ''}`}
          >
            {!sidebarCollapsed ? 'Sair' : <span title="Sair"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15" /><path strokeLinecap="round" strokeLinejoin="round" d="M18 12H9m0 0l3-3m-3 3l3 3" /></svg></span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto p-0 min-w-0 min-h-0 relative isolate">
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
