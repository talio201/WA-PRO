
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Download,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
    deleteCampaign,
    getCampaignFailures,
    getCampaigns,
    getMessages,
    retryMessage,
    updateMessage,
} from '../utils/api';
import { connectRealtime } from '../utils/realtime';

const GLASS_MODE_STORAGE_KEY = 'wa-manager-campaigns-glass-mode';
const CAMPAIGNS_FALLBACK_REFRESH_INTERVAL_MS = 45000;

const getStoredGlassMode = () => {
    if (typeof window === 'undefined') return true;

    try {
        const storedValue = window.localStorage.getItem(GLASS_MODE_STORAGE_KEY);
        if (storedValue === null) return true;
        return storedValue === '1';
    } catch (error) {
        console.error('Failed to read glass mode preference:', error);
        return true;
    }
};

const getStats = (campaign) => {
    const total = Number(campaign?.stats?.total || 0);
    const sent = Number(campaign?.stats?.sent || 0);
    const failed = Number(campaign?.stats?.failed || 0);
    const pending = Math.max(total - sent - failed, 0);
    const progress = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;
    return { total, sent, failed, pending, progress };
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '-');

const escapeCsvValue = (value) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

const isCriticalCampaign = (campaign) => {
    const queueThreshold = Math.max(5, Math.round(Number(campaign.total || 0) * 0.4));
    return Number(campaign.failed || 0) > 0 || (campaign.status === 'running' && Number(campaign.pending || 0) > queueThreshold);
};

const getStatusMeta = (campaign) => {
    if (campaign.status === 'running') {
        return {
            label: 'Executando',
            className: 'bg-emerald-100 text-emerald-700',
        };
    }

    if (campaign.status === 'paused') {
        return {
            label: 'Pausada',
            className: 'bg-amber-100 text-amber-700',
        };
    }

    return {
        label: 'Concluida',
        className: 'bg-slate-100 text-slate-700',
    };
};

const Campaigns = () => {
    const [campaigns, setCampaigns] = useState([]);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [realtimeStatus, setRealtimeStatus] = useState('connecting');
    const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [sortBy, setSortBy] = useState('recent');
    const [deletingId, setDeletingId] = useState(null);
    const [dispatchingCampaignId, setDispatchingCampaignId] = useState(null);
    const [glassMode, setGlassMode] = useState(getStoredGlassMode);

    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [failures, setFailures] = useState([]);
    const [loadingFailures, setLoadingFailures] = useState(false);
    const [savingMessageId, setSavingMessageId] = useState(null);
    const [retryingMessageId, setRetryingMessageId] = useState(null);
    const [messageEdits, setMessageEdits] = useState({});
    const syncInFlightRef = useRef(false);
    const realtimeReloadTimerRef = useRef(null);

    const loadDashboardData = useCallback(async (options = {}) => {
        const showSpinner = options.showSpinner !== false;
        if (syncInFlightRef.current) return;
        syncInFlightRef.current = true;

        if (showSpinner) {
            setSyncing(true);
        }

        try {
            const [campaignsData, messagesData] = await Promise.all([
                getCampaigns(),
                getMessages({ limit: 1000 }),
            ]);

            setCampaigns(campaignsData || []);
            setMessages(messagesData || []);
            setLastSyncAt(new Date());
        } catch (err) {
            console.error('loadDashboardData error:', err);
        } finally {
            setLoading(false);
            if (showSpinner) {
                setSyncing(false);
            }
            syncInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    useEffect(() => {
        const disposeRealtime = connectRealtime({
            onStatus: (status) => {
                setRealtimeStatus(status);
            },
            onEvent: (message) => {
                if (!autoRefresh) return;

                const eventName = String(message?.event || '');
                setLastRealtimeAt(message?.at || new Date().toISOString());

                const shouldReload = eventName.startsWith('campaign.')
                    || eventName.startsWith('messages.')
                    || eventName === 'upload.completed'
                    || eventName.startsWith('ai.');

                if (!shouldReload) return;

                if (realtimeReloadTimerRef.current) {
                    clearTimeout(realtimeReloadTimerRef.current);
                }

                realtimeReloadTimerRef.current = setTimeout(() => {
                    realtimeReloadTimerRef.current = null;
                    loadDashboardData({ showSpinner: false });
                }, 260);
            },
        });

        return () => {
            disposeRealtime();
            if (realtimeReloadTimerRef.current) {
                clearTimeout(realtimeReloadTimerRef.current);
                realtimeReloadTimerRef.current = null;
            }
        };
    }, [autoRefresh, loadDashboardData]);

    useEffect(() => {
        if (!autoRefresh || realtimeStatus === 'connected') return undefined;

        const interval = setInterval(() => {
            loadDashboardData({ showSpinner: false });
        }, CAMPAIGNS_FALLBACK_REFRESH_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [autoRefresh, realtimeStatus, loadDashboardData]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            window.localStorage.setItem(GLASS_MODE_STORAGE_KEY, glassMode ? '1' : '0');
        } catch (error) {
            console.error('Failed to persist glass mode preference:', error);
        }
    }, [glassMode]);

    const campaignRows = useMemo(() => campaigns.map((campaign) => ({
        ...campaign,
        ...getStats(campaign),
    })), [campaigns]);

    const totals = useMemo(() => {
        const sent = campaignRows.reduce((acc, item) => acc + item.sent, 0);
        const failed = campaignRows.reduce((acc, item) => acc + item.failed, 0);
        const pending = campaignRows.reduce((acc, item) => acc + item.pending, 0);
        const successRate = sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : 0;
        const running = campaignRows.filter((item) => item.status === 'running').length;
        const withFailures = campaignRows.filter((item) => item.failed > 0).length;
        const critical = campaignRows.filter(isCriticalCampaign).length;
        const completionRate = campaignRows.length > 0
            ? Math.round(campaignRows.reduce((acc, item) => acc + item.progress, 0) / campaignRows.length)
            : 0;

        return {
            sent,
            failed,
            pending,
            successRate,
            running,
            withFailures,
            critical,
            completionRate,
            contacts: new Set(messages.map((m) => m.phone).filter(Boolean)).size,
            replies: messages.filter((m) => m.direction === 'inbound').length,
        };
    }, [campaignRows, messages]);

    const filteredCampaigns = useMemo(() => {
        const query = search.trim().toLowerCase();
        let list = [...campaignRows];

        if (query) {
            list = list.filter((item) => String(item.name || '').toLowerCase().includes(query));
        }

        if (filter === 'running') list = list.filter((item) => item.status === 'running');
        if (filter === 'queue') list = list.filter((item) => item.pending > 0);
        if (filter === 'failures') list = list.filter((item) => item.failed > 0);
        if (filter === 'critical') list = list.filter((item) => isCriticalCampaign(item));

        if (sortBy === 'recent') {
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        if (sortBy === 'progress') {
            list.sort((a, b) => b.progress - a.progress);
        }
        if (sortBy === 'failures') {
            list.sort((a, b) => b.failed - a.failed);
        }
        if (sortBy === 'name') {
            list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        }
        if (sortBy === 'queue') {
            list.sort((a, b) => b.pending - a.pending);
        }

        return list;
    }, [campaignRows, filter, search, sortBy]);

    const chartData = useMemo(() => filteredCampaigns.slice(0, 8).map((item) => ({
        name: String(item.name || '').slice(0, 12),
        enviados: item.sent,
        falhas: item.failed,
    })), [filteredCampaigns]);

    const recentActivity = useMemo(() => [...messages]
        .sort((a, b) => new Date(b.updatedAt || b.sentAt || b.createdAt || 0) - new Date(a.updatedAt || a.sentAt || a.createdAt || 0))
        .slice(0, 10), [messages]);

    const quickFilters = useMemo(() => ([
        { id: 'all', label: 'Todas', count: campaignRows.length },
        { id: 'running', label: 'Executando', count: totals.running },
        { id: 'queue', label: 'Com fila', count: campaignRows.filter((item) => item.pending > 0).length },
        { id: 'failures', label: 'Com falhas', count: totals.withFailures },
        { id: 'critical', label: 'Criticas', count: totals.critical },
    ]), [campaignRows, totals]);

    const clearFilters = () => {
        setSearch('');
        setFilter('all');
        setSortBy('recent');
    };

    const exportCampaignsCsv = () => {
        if (filteredCampaigns.length === 0) {
            alert('Nao ha campanhas para exportar com os filtros atuais.');
            return;
        }

        const headers = ['Nome', 'Status', 'Enviadas', 'Falhas', 'Pendentes', 'Total', 'Progresso', 'Criada em'];
        const rows = filteredCampaigns.map((campaign) => {
            const meta = getStatusMeta(campaign);

            return [
                campaign.name || '-',
                meta.label,
                campaign.sent,
                campaign.failed,
                campaign.pending,
                campaign.total,
                `${campaign.progress}%`,
                formatDate(campaign.createdAt),
            ].map(escapeCsvValue).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `campanhas-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.URL.revokeObjectURL(url);
    };

    const handleDeleteCampaign = async (campaign) => {
        if (!window.confirm(`Excluir a campanha "${campaign.name}"?`)) return;

        try {
            setDeletingId(campaign._id);
            await deleteCampaign(campaign._id);
            setCampaigns((prev) => prev.filter((item) => item._id !== campaign._id));
        } catch (error) {
            console.error('Delete campaign error:', error);
            alert('Nao foi possivel excluir a campanha.');
        } finally {
            setDeletingId(null);
        }
    };

    const sendRuntimeMessage = useCallback((payload) => new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            reject(new Error('Bridge da extensao indisponivel.'));
            return;
        }

        chrome.runtime.sendMessage(payload, (response) => {
            const runtimeError = chrome.runtime?.lastError;
            if (runtimeError) {
                reject(new Error(runtimeError.message));
                return;
            }

            if (!response?.success) {
                reject(new Error(response?.error || 'Falha ao acionar disparo da campanha.'));
                return;
            }

            resolve(response);
        });
    }), []);

    const handleDispatchCampaign = useCallback(async (campaign) => {
        if (!campaign?._id) return;
        if (Number(campaign?.pending || 0) <= 0) return;

        try {
            setDispatchingCampaignId(campaign._id);
            await sendRuntimeMessage({
                action: 'TRIGGER_CAMPAIGN_SEND',
                campaignId: campaign._id,
                focusTab: true,
            });

            setAutoRefresh(true);
            await loadDashboardData({ showSpinner: false });
            alert(`Disparo iniciado para "${campaign.name}". A fila vai seguir o anti-ban ate concluir os contatos pendentes.`);
        } catch (error) {
            console.error('Dispatch campaign error:', error);
            alert(error?.message || 'Nao foi possivel disparar esta campanha agora.');
        } finally {
            setDispatchingCampaignId(null);
        }
    }, [loadDashboardData, sendRuntimeMessage]);

    const buildEditState = (items) => {
        const result = {};
        items.forEach((item) => {
            result[item._id] = {
                phone: item.phoneOriginal || item.phone || '',
                name: item.name || '',
                processedMessage: item.processedMessage || '',
            };
        });
        return result;
    };

    const openFailuresModal = async (campaign) => {
        setSelectedCampaign(campaign);
        setLoadingFailures(true);
        setFailures([]);

        try {
            const response = await getCampaignFailures(campaign._id);
            const list = response.failures || [];
            setFailures(list);
            setMessageEdits(buildEditState(list));
        } catch (error) {
            console.error('Failed to load campaign failures:', error);
            alert('Nao foi possivel carregar as falhas desta campanha.');
        } finally {
            setLoadingFailures(false);
        }
    };

    const closeFailuresModal = () => {
        setSelectedCampaign(null);
        setFailures([]);
        setMessageEdits({});
        setSavingMessageId(null);
        setRetryingMessageId(null);
    };

    const handleEditChange = (messageId, field, value) => {
        setMessageEdits((prev) => ({
            ...prev,
            [messageId]: {
                ...(prev[messageId] || {}),
                [field]: value,
            },
        }));
    };

    const handleSaveMessage = async (messageId) => {
        const payload = messageEdits[messageId] || {};

        try {
            setSavingMessageId(messageId);
            const updated = await updateMessage(messageId, payload);
            setFailures((prev) => prev.map((item) => (item._id === messageId ? updated : item)));
            alert('Mensagem atualizada com sucesso.');
        } catch (error) {
            console.error('Save message error:', error);
            alert('Nao foi possivel salvar as alteracoes.');
        } finally {
            setSavingMessageId(null);
        }
    };

    const handleRetryMessage = async (messageId) => {
        const payload = messageEdits[messageId] || {};

        try {
            setRetryingMessageId(messageId);
            await retryMessage(messageId, payload);
            setFailures((prev) => prev.filter((item) => item._id !== messageId));
            setMessageEdits((prev) => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
            await loadDashboardData();
        } catch (error) {
            console.error('Retry message error:', error);
            alert('Nao foi possivel reenfileirar a mensagem.');
        } finally {
            setRetryingMessageId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                <RefreshCw size={16} className="animate-spin text-slate-500" />
                <span>Carregando dados...</span>
            </div>
        );
    }

    const panelClass = glassMode
        ? 'rounded-[24px] border border-white/55 bg-white/65 shadow-[0_28px_65px_-42px_rgba(15,23,42,0.6)] backdrop-blur-2xl'
        : 'rounded-xl border border-slate-200 bg-white shadow-sm';

    const heroMetricClass = glassMode
        ? 'rounded-xl border border-white/50 bg-white/55 p-4 backdrop-blur-xl'
        : 'rounded-xl border border-slate-200 bg-slate-50 p-4';

    const neutralButtonClass = glassMode
        ? 'inline-flex items-center gap-2 rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white'
        : 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';

    const accentButtonClass = glassMode
        ? 'inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/30'
        : 'inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700';

    const inputClass = glassMode
        ? 'w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-700 outline-none backdrop-blur focus:border-emerald-400'
        : 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500';

    const tableHeadClass = glassMode
        ? 'bg-white/45 text-slate-700'
        : 'bg-slate-50 text-slate-600';

    const quickFilterBase = glassMode
        ? 'rounded-full border border-white/55 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white'
        : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100';

    const quickFilterActive = glassMode
        ? 'border-emerald-300/70 bg-emerald-500/20 text-emerald-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

    const realtimeLabel = realtimeStatus === 'connected'
        ? `Tempo real ativo${lastRealtimeAt ? ` (${new Date(lastRealtimeAt).toLocaleTimeString()})` : ''}`
        : realtimeStatus === 'connecting'
            ? 'Conectando websocket...'
            : 'Fallback ativo por intervalo';

    const realtimeClass = realtimeStatus === 'connected'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : realtimeStatus === 'connecting'
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-amber-200 bg-amber-50 text-amber-700';

    return (
        <>
            <div className={`campaigns-page space-y-6 ${glassMode ? 'campaigns-page--glass' : ''}`}>
                <section className={`${panelClass} p-5 md:p-6`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations</p>
                            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Painel de Campanhas</h2>
                            <p className="mt-1 text-sm text-slate-600">Fluxo de envio, falhas e produtividade em uma visao executiva unica.</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setGlassMode((prev) => !prev)}
                                className={neutralButtonClass}
                            >
                                <Sparkles size={14} />
                                {glassMode ? 'Apple Glass ON' : 'Apple Glass OFF'}
                            </button>
                            <button
                                type="button"
                                onClick={exportCampaignsCsv}
                                className={neutralButtonClass}
                            >
                                <Download size={14} />
                                Exportar CSV
                            </button>
                            <button
                                type="button"
                                onClick={loadDashboardData}
                                disabled={syncing}
                                className={`${accentButtonClass} ${syncing ? 'cursor-wait opacity-80' : ''}`}
                            >
                                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                                {syncing ? 'Sincronizando...' : 'Atualizar agora'}
                            </button>
                            <label className={neutralButtonClass}>
                                <input
                                    type="checkbox"
                                    checked={autoRefresh}
                                    onChange={(e) => setAutoRefresh(e.target.checked)}
                                    className="h-3.5 w-3.5"
                                />
                                Auto refresh
                            </label>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-500">
                            Ultima sincronizacao: {lastSyncAt ? lastSyncAt.toLocaleTimeString() : '-'}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${realtimeClass}`}>
                            {realtimeLabel}
                        </span>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Enviadas</span>
                                <CheckCircle2 size={15} className="text-emerald-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.sent}</div>
                        </div>

                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Taxa sucesso</span>
                                <Activity size={15} className="text-blue-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.successRate}%</div>
                        </div>

                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Na fila</span>
                                <Clock3 size={15} className="text-amber-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.pending}</div>
                        </div>

                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Falhas</span>
                                <AlertTriangle size={15} className="text-red-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.failed}</div>
                        </div>

                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Criticas</span>
                                <AlertTriangle size={15} className="text-orange-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.critical}</div>
                        </div>

                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
                                <span>Contatos</span>
                                <Activity size={15} className="text-indigo-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-900">{totals.contacts}</div>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className={`${panelClass} p-5 lg:col-span-1`}>
                        <h3 className="text-base font-semibold text-slate-900">Resumo operacional</h3>
                        <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2 text-sm">
                                <span className="text-slate-600">Executando</span>
                                <span className="font-bold text-slate-900">{totals.running}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2 text-sm">
                                <span className="text-slate-600">Com falha</span>
                                <span className="font-bold text-slate-900">{totals.withFailures}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2 text-sm">
                                <span className="text-slate-600">Respostas</span>
                                <span className="font-bold text-slate-900">{totals.replies}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2 text-sm">
                                <span className="text-slate-600">Conclusao media</span>
                                <span className="font-bold text-slate-900">{totals.completionRate}%</span>
                            </div>
                        </div>
                    </div>

                    <div className={`${panelClass} p-5 lg:col-span-2`}>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-slate-900">Performance</h3>
                            <span className="text-xs text-slate-500">Top 8 campanhas filtradas</span>
                        </div>
                        <div className="h-64 min-h-[256px] min-w-0 overflow-hidden">
                            {chartData.length === 0 ? (
                                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
                                    Sem dados para os filtros selecionados.
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={240} minWidth={0} debounce={120}>
                                    <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 6, left: -8 }}>
                                        <XAxis dataKey="name" fontSize={12} />
                                        <YAxis fontSize={12} />
                                        <Tooltip />
                                        <Bar dataKey="enviados" fill="#10B981" radius={[6, 6, 0, 0]} />
                                        <Bar dataKey="falhas" fill="#EF4444" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </section>

                <section className={`${panelClass} overflow-hidden`}>
                    <div className="border-b border-slate-200/80 px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">Campanhas</h3>
                                <p className="text-xs text-slate-500">{filteredCampaigns.length} de {campaignRows.length} exibidas.</p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative min-w-[220px]">
                                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Buscar campanha..."
                                        className={`${inputClass} pl-9`}
                                    />
                                </div>

                                <div className="inline-flex items-center gap-2">
                                    <SlidersHorizontal size={14} className="text-slate-500" />
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        className={inputClass}
                                    >
                                        <option value="recent">Mais recentes</option>
                                        <option value="progress">Maior progresso</option>
                                        <option value="queue">Maior fila</option>
                                        <option value="failures">Mais falhas</option>
                                        <option value="name">Nome A-Z</option>
                                    </select>
                                </div>

                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className={neutralButtonClass}
                                >
                                    Limpar filtros
                                </button>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {quickFilters.map((quickFilter) => (
                                <button
                                    key={quickFilter.id}
                                    type="button"
                                    onClick={() => setFilter(quickFilter.id)}
                                    className={`${quickFilterBase} ${filter === quickFilter.id ? quickFilterActive : ''}`}
                                >
                                    {quickFilter.label}
                                    <span className="ml-2 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                        {quickFilter.count}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="campaigns-table w-full min-w-[980px] text-left text-sm">
                            <thead className={`text-xs uppercase tracking-wide ${tableHeadClass}`}>
                                <tr>
                                    <th className="px-5 py-3">Campanha</th>
                                    <th className="px-5 py-3">Status</th>
                                    <th className="px-5 py-3">Progresso</th>
                                    <th className="px-5 py-3">Fila</th>
                                    <th className="px-5 py-3">Anti-ban</th>
                                    <th className="px-5 py-3">Criada</th>
                                    <th className="px-5 py-3 text-right">Acoes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCampaigns.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="px-5 py-10 text-center text-sm text-slate-500">
                                            Nenhuma campanha encontrada para os filtros atuais.
                                        </td>
                                    </tr>
                                ) : filteredCampaigns.map((campaign) => {
                                    const statusMeta = getStatusMeta(campaign);
                                    const progressBarClass = campaign.failed > 0
                                        ? 'bg-gradient-to-r from-amber-500 to-red-500'
                                        : campaign.status === 'running'
                                            ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                            : 'bg-gradient-to-r from-sky-400 to-blue-500';
                                    const critical = isCriticalCampaign(campaign);

                                    return (
                                        <tr key={campaign._id} className="border-t border-slate-100 align-top">
                                            <td className="px-5 py-4">
                                                <div className="font-semibold text-slate-900">{campaign.name}</div>
                                                <div className="mt-1 text-xs text-slate-500">Enviadas: {campaign.sent} | Falhas: {campaign.failed}</div>
                                                {critical && (
                                                    <span className="mt-2 inline-flex rounded-full bg-orange-100 px-2 py-1 text-[11px] font-semibold text-orange-700">
                                                        Prioridade
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusMeta.className}`}>
                                                    {statusMeta.label}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                                                    <span>{campaign.sent + campaign.failed}/{campaign.total}</span>
                                                    <span>{campaign.progress}%</span>
                                                </div>
                                                <div className="h-2 rounded-full bg-slate-100">
                                                    <div className={`h-2 rounded-full ${progressBarClass}`} style={{ width: `${campaign.progress}%` }} />
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="text-sm font-semibold text-slate-900">{campaign.pending}</div>
                                                <div className="text-xs text-slate-500">pendente(s)</div>
                                            </td>
                                            <td className="px-5 py-4 text-slate-700">
                                                {Number(campaign?.antiBan?.minDelaySeconds || 0)}s - {Number(campaign?.antiBan?.maxDelaySeconds || 0)}s
                                            </td>
                                            <td className="px-5 py-4 text-xs text-slate-600">{formatDate(campaign.createdAt)}</td>
                                            <td className="px-5 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDispatchCampaign(campaign)}
                                                        disabled={dispatchingCampaignId === campaign._id || campaign.pending <= 0}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                                            dispatchingCampaignId === campaign._id
                                                                ? 'cursor-not-allowed bg-emerald-200 text-emerald-500'
                                                                : campaign.pending <= 0
                                                                    ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                                                                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                                        }`}
                                                    >
                                                        <CheckCircle2 size={13} />
                                                        {dispatchingCampaignId === campaign._id ? 'Disparando...' : 'Disparar agora'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openFailuresModal(campaign)}
                                                        disabled={campaign.failed === 0}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${campaign.failed === 0 ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}
                                                    >
                                                        <AlertTriangle size={13} />
                                                        Falhas ({campaign.failed})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteCampaign(campaign)}
                                                        disabled={deletingId === campaign._id}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${deletingId === campaign._id ? 'cursor-not-allowed bg-red-200 text-red-400' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                                                    >
                                                        <Trash2 size={13} />
                                                        {deletingId === campaign._id ? 'Excluindo...' : 'Excluir'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className={`${panelClass} overflow-hidden`}>
                    <div className="border-b border-slate-200/80 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-900">Atividade recente</h3>
                        <p className="text-xs text-slate-500">Ultimos 10 eventos de envio.</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {recentActivity.length === 0 ? (
                            <div className="px-5 py-6 text-sm text-slate-500">Nenhuma atividade recente encontrada.</div>
                        ) : recentActivity.map((item) => (
                            <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-slate-800">{item.name || item.phone || 'Contato sem nome'}</div>
                                    <div className="truncate text-xs text-slate-500">{item.processedMessage || 'Sem texto'}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : item.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                                        {item.status || 'pending'}
                                    </span>
                                    <span className="text-xs text-slate-500">{formatDate(item.updatedAt || item.sentAt || item.createdAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className={`flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl ${glassMode ? 'rounded-[24px] border border-white/60 bg-white/80 backdrop-blur-2xl' : 'rounded-xl bg-white'}`}>
                        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Falhas da Campanha</h3>
                                <p className="text-sm text-gray-500">{selectedCampaign.name}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeFailuresModal}
                                className={neutralButtonClass}
                            >
                                <X size={14} />
                                Fechar
                            </button>
                        </div>

                        <div className="overflow-y-auto p-6">
                            {loadingFailures ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-center text-sm text-gray-500">
                                    <RefreshCw size={14} className="animate-spin" />
                                    <span>Carregando falhas...</span>
                                </div>
                            ) : failures.length === 0 ? (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                                    Nenhuma falha pendente para auditoria.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {failures.map((item) => {
                                        const edit = messageEdits[item._id] || {};
                                        const isSaving = savingMessageId === item._id;
                                        const isRetrying = retryingMessageId === item._id;

                                        return (
                                            <div key={item._id} className={`rounded-lg border p-4 ${glassMode ? 'border-white/60 bg-white/65 shadow-sm backdrop-blur' : 'border-gray-200 bg-white shadow-sm'}`}>
                                                <div className="mb-2 text-xs text-red-700">Motivo: {item.lastError || item.error || 'Erro nao informado'}</div>
                                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                    <input
                                                        type="text"
                                                        value={edit.phone || ''}
                                                        onChange={(e) => handleEditChange(item._id, 'phone', e.target.value)}
                                                        className={inputClass}
                                                        placeholder="Telefone"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={edit.name || ''}
                                                        onChange={(e) => handleEditChange(item._id, 'name', e.target.value)}
                                                        className={inputClass}
                                                        placeholder="Nome"
                                                    />
                                                </div>
                                                <textarea
                                                    rows="3"
                                                    value={edit.processedMessage || ''}
                                                    onChange={(e) => handleEditChange(item._id, 'processedMessage', e.target.value)}
                                                    className={`mt-3 resize-y ${inputClass}`}
                                                    placeholder="Mensagem"
                                                />
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveMessage(item._id)}
                                                        disabled={isSaving || isRetrying}
                                                        className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${isSaving || isRetrying ? 'cursor-not-allowed bg-slate-300' : 'bg-blue-600 hover:bg-blue-700'}`}
                                                    >
                                                        {isSaving ? 'Salvando...' : 'Salvar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRetryMessage(item._id)}
                                                        disabled={isSaving || isRetrying}
                                                        className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${isSaving || isRetrying ? 'cursor-not-allowed bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                                    >
                                                        {isRetrying ? 'Reenfileirando...' : 'Salvar + reenfileirar'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Campaigns;
