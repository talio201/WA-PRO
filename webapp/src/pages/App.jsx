import React, { useEffect, useState } from 'react';
import { 
  ChartBarSquareIcon, 
  ChatBubbleLeftRightIcon, 
  RocketLaunchIcon, 
  UsersIcon, 
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightOnRectangleIcon,
  QrCodeIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../auth/AuthContext.jsx';
import { fetchBotStatus } from '../utils/api.js';

// Import pages
import Dashboard from './Dashboard.jsx';
import Campaigns from './Campaigns.jsx';
import NewCampaign from './NewCampaign.jsx';
import Inbox from './Inbox.jsx';
import Contacts from './Contacts.jsx';
import Settings from './Settings.jsx';

const tabs = [
  { id: 'dashboard', label: 'Visão Geral', icon: <ChartBarSquareIcon className="w-5 h-5" /> },
  { id: 'campaigns', label: 'Campanhas', icon: <RocketLaunchIcon className="w-5 h-5" /> },
  { id: 'inbox', label: 'Atendimentos', icon: <ChatBubbleLeftRightIcon className="w-5 h-5" /> },
  { id: 'contacts', label: 'Contatos', icon: <UsersIcon className="w-5 h-5" /> },
  { id: 'settings', label: 'Configurações', icon: <Cog6ToothIcon className="w-5 h-5" /> },
];

export default function App() {
  const { supabase, session } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [botState, setBotState] = useState({ status: 'DISCONNECTED', qrCode: null });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (tabs.find((t) => t.id === hash) || hash === 'new-campaign') setActiveTab(hash);
    const onHash = () => {
      const h = location.hash.replace('#', '');
      if (tabs.find((t) => t.id === h) || h === 'new-campaign') setActiveTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigateTo = (tabId) => {
    location.hash = tabId;
    setActiveTab(tabId);
  };

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetchBotStatus();
        if (res) setBotState({ status: res.status || 'DISCONNECTED', qrCode: res.qrCode || null });
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const agentLabel = session?.user?.user_metadata?.agentId ||
    session?.user?.email?.split('@')[0] ||
    'Usuário';

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'campaigns': return <Campaigns />;
      case 'inbox': return <Inbox />;
      case 'new-campaign': return <NewCampaign onCancel={() => navigateTo('campaigns')} />;
      case 'contacts': return <Contacts />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  const botStatusColor = botState.status === 'LOGGED_IN' ? 'bg-emerald-500' :
    botState.status === 'AWAITING_QR' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-rose-500';

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className={`crm-sidebar flex flex-col transition-all duration-300 ease-in-out border-r border-white/5 ${sidebarCollapsed ? 'w-20' : 'w-72'} h-full relative z-20`}>
        {/* Header */}
        <div className="p-6 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
                <RocketLaunchIcon className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-lg tracking-tight">Emidia<span className="text-indigo-500">Pro</span></h1>
            </div>
          )}
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-400 hover:text-white"
          >
            {sidebarCollapsed ? <ChevronRightIcon className="w-5 h-5" /> : <ChevronLeftIcon className="w-5 h-5" />}
          </button>
        </div>

        {/* User Profile */}
        {!sidebarCollapsed && (
          <div className="px-6 mb-8">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Operador</p>
              <p className="text-sm font-semibold text-white mt-1 truncate">{agentLabel}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${botStatusColor} animate-pulse`} />
                <span className="text-[10px] text-slate-400 font-medium">{botState.status}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <nav className="flex-1 px-4 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigateTo(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all group ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <span className={`${activeTab === tab.id ? 'text-white' : 'text-slate-500 group-hover:text-indigo-400'} transition-colors`}>
                {tab.icon}
              </span>
              {!sidebarCollapsed && <span>{tab.label}</span>}
              {activeTab === tab.id && !sidebarCollapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_white]" />
              )}
            </button>
          ))}
        </nav>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/5 space-y-2">
          {botState.status === 'AWAITING_QR' && botState.qrCode && !sidebarCollapsed && (
            <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 mb-4 animate-fade-in">
               <div className="flex items-center gap-2 mb-2 text-amber-200">
                  <QrCodeIcon className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-tight">Escaneie o QR</span>
               </div>
               <img src={botState.qrCode} alt="WhatsApp QR" className="w-full bg-white rounded-lg p-1.5" />
            </div>
          )}
          
          <button
            onClick={logout}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/5 transition-all ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            {!sidebarCollapsed && <span>Sair da conta</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative bg-slate-950">
        <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-indigo-600/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-7xl mx-auto">
           {renderContent()}
        </div>
      </main>
    </div>
  );
}
