import React, { useEffect, useState } from 'react';
import { 
  ArrowUpIcon, 
  ArrowDownIcon, 
  ChatBubbleLeftRightIcon, 
  PaperAirplaneIcon, 
  UsersIcon, 
  ExclamationCircleIcon 
} from '@heroicons/react/24/outline';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { getCampaigns, getMessages } from '../utils/api';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSent: 0,
    totalFailed: 0,
    activeCampaigns: 0,
    totalContacts: 0,
    history: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [campaigns, messages] = await Promise.all([
          getCampaigns(),
          getMessages({ limit: 1000 })
        ]);

        const sent = campaigns.reduce((acc, c) => acc + (c.stats?.sent || 0), 0);
        const failed = campaigns.reduce((acc, c) => acc + (c.stats?.failed || 0), 0);
        const active = campaigns.filter(c => c.status === 'running').length;
        const contacts = new Set(messages.map(m => m.phone)).size;

        // Mock history for chart
        const history = [
          { name: 'Seg', sent: Math.floor(sent * 0.1) },
          { name: 'Ter', sent: Math.floor(sent * 0.15) },
          { name: 'Qua', sent: Math.floor(sent * 0.2) },
          { name: 'Qui', sent: Math.floor(sent * 0.18) },
          { name: 'Sex', sent: Math.floor(sent * 0.25) },
          { name: 'Sáb', sent: Math.floor(sent * 0.08) },
          { name: 'Dom', sent: Math.floor(sent * 0.04) },
        ];

        setStats({ totalSent: sent, totalFailed: failed, activeCampaigns: active, totalContacts: contacts, history });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  if (loading) return <div className="p-8 animate-pulse text-slate-400">Carregando métricas...</div>;

  return (
    <div className="p-6 space-y-8 animate-fade-in">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Visão Geral</h1>
        <p className="text-slate-400 mt-1 text-sm">Acompanhe o desempenho de seus disparos em tempo real.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Mensagens Enviadas', value: stats.totalSent, icon: PaperAirplaneIcon, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Contatos Únicos', value: stats.totalContacts, icon: UsersIcon, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
          { label: 'Campanhas Ativas', value: stats.activeCampaigns, icon: ChatBubbleLeftRightIcon, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Falhas de Envio', value: stats.totalFailed, icon: ExclamationCircleIcon, color: 'text-rose-400', bg: 'bg-rose-500/10' },
        ].map((item, i) => (
          <div key={i} className="glass-card p-6 flex items-center gap-4 group hover:border-indigo-500/50 transition-all duration-300">
            <div className={`p-3 rounded-2xl ${item.bg} ${item.color}`}>
              <item.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{item.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{item.value.toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg">Volume de Envios (Semana)</h3>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full border border-indigo-500/20">+12% vs última semana</span>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.history}>
                <defs>
                  <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #ffffff20', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area type="monotone" dataKey="sent" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorSent)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="glass-card p-6">
          <h3 className="font-semibold text-lg mb-6">Status da Operação</h3>
          <div className="space-y-6">
            {[
              { label: 'Taxa de Entrega', value: '98.2%', progress: 98, color: 'bg-emerald-500' },
              { label: 'Resposta de Leads', value: '14.5%', progress: 45, color: 'bg-indigo-500' },
              { label: 'Uso de Créditos', value: '62%', progress: 62, color: 'bg-amber-500' },
            ].map((item, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">{item.label}</span>
                  <span className="text-white font-medium">{item.value}</span>
                </div>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full ${item.color} rounded-full transition-all duration-1000`} style={{ width: `${item.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-8 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
            <p className="text-xs text-indigo-300 leading-relaxed font-medium">
              💡 Dica Pro: Otimize seu tempo de resposta no Atendimento para aumentar a taxa de conversão em até 22%.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
