import React, { useMemo, useState } from 'react';
import Campaigns from '../pages/Campaigns';
import NewCampaign from '../pages/NewCampaign';
import Settings from '../pages/Settings';
import Inbox from '../pages/Inbox';
import Contacts from '../pages/Contacts';

const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'inbox', label: 'Atendimentos', icon: '💬' },
    { id: 'new-campaign', label: 'Nova Campanha', icon: '🚀' },
    { id: 'contacts', label: 'Contatos', icon: '👥' },
    { id: 'settings', label: 'Configuracoes', icon: '⚙️' },
];

const pageTitles = {
    dashboard: 'Dashboard',
    inbox: 'Atendimentos',
    'new-campaign': 'Nova Campanha',
    contacts: 'Contatos',
    settings: 'Configuracoes',
};

const Dashboard = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [darkMode, setDarkMode] = useState(false);

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard':
                return <Campaigns />;
            case 'inbox':
                return <Inbox />;
            case 'new-campaign':
                return <NewCampaign onCancel={() => setActiveTab('dashboard')} />;
            case 'contacts':
                return <Contacts />;
            case 'settings':
                return <Settings />;
            default:
                return <Campaigns />;
        }
    };

    const appClass = useMemo(() => (
        darkMode
            ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100'
            : 'bg-gradient-to-br from-slate-100 via-sky-50 to-emerald-50 text-slate-900'
    ), [darkMode]);

    const sidebarClass = useMemo(() => (
        darkMode
            ? 'bg-slate-900/72 border-slate-700/60 text-white'
            : 'bg-white/66 border-white/60 text-slate-900'
    ), [darkMode]);

    const headerClass = useMemo(() => (
        darkMode
            ? 'border-slate-700/50 bg-slate-900/58 text-slate-100'
            : 'border-white/60 bg-white/70 text-slate-900'
    ), [darkMode]);

    const navIdleClass = darkMode
        ? 'text-slate-300 hover:bg-slate-800/75'
        : 'text-slate-700 hover:bg-white/70';

    return (
        <div className={`relative flex min-h-screen overflow-hidden ${appClass} font-sans`}>
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className={`absolute -left-24 top-[-80px] h-72 w-72 rounded-full blur-3xl ${darkMode ? 'bg-fuchsia-500/20' : 'bg-emerald-300/35'}`} />
                <div className={`absolute right-[-120px] top-[120px] h-80 w-80 rounded-full blur-3xl ${darkMode ? 'bg-sky-500/20' : 'bg-sky-300/35'}`} />
                <div
                    className={`absolute ${activeTab === 'inbox' ? 'bottom-[-140px] opacity-45' : 'bottom-[-90px]'} left-[35%] h-72 w-72 rounded-full blur-3xl ${
                        darkMode
                            ? activeTab === 'inbox'
                                ? 'bg-cyan-500/10'
                                : 'bg-cyan-500/15'
                            : activeTab === 'inbox'
                                ? 'bg-amber-200/20'
                                : 'bg-amber-200/38'
                    }`}
                />
            </div>

            <aside className={`relative z-10 sticky top-0 h-screen self-start w-[270px] border-r backdrop-blur-2xl flex flex-col ${sidebarClass}`}>
                <div className={`px-5 py-5 ${darkMode ? 'border-slate-700/50' : 'border-white/60'} border-b`}>
                    <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-xl text-center text-xl leading-10 ${darkMode ? 'bg-emerald-400/20' : 'bg-emerald-500/20'}`}>📱</div>
                        <div>
                            <div className={`text-[28px] font-bold tracking-tight leading-none ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>WA Manager</div>
                            <div className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Campaign Suite</div>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 space-y-1 p-3">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-medium transition-colors ${activeTab === tab.id ? 'bg-emerald-600 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)]' : navIdleClass}`}
                        >
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </nav>

                <div className={`space-y-3 p-4 border-t ${darkMode ? 'border-slate-700/50' : 'border-white/60'}`}>
                    <button
                        type="button"
                        onClick={() => setDarkMode((prev) => !prev)}
                        className={`w-full rounded-lg px-3 py-2 text-sm font-semibold ${darkMode ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-white/75 text-slate-700 hover:bg-white'}`}
                    >
                        {darkMode ? 'Light Glass' : 'Night Glass'}
                    </button>
                    <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                        <span>Status: Online</span>
                    </div>
                    <div className={`text-[11px] ${darkMode ? 'text-slate-500' : 'text-slate-500'}`}>v2.3.0</div>
                </div>
            </aside>

            <main className="relative z-10 min-w-0 flex-1">
                <header className={`sticky top-0 z-10 flex h-20 items-center justify-between border-b px-10 backdrop-blur-2xl ${headerClass}`}>
                    <h1 className="text-[32px] font-bold tracking-tight">{pageTitles[activeTab] || 'Dashboard'}</h1>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setActiveTab('new-campaign')}
                            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                            + Nova Campanha
                        </button>
                    </div>
                </header>

                <div className="px-10 pb-10 pt-8">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
