import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckCircleIcon,
    ArrowPathIcon,
    MagnifyingGlassIcon,
    ExclamationTriangleIcon,
    ClockIcon,
    PencilIcon,
    TrashIcon,
    ArrowDownTrayIcon,
    SparklesIcon,
    XMarkIcon,
    UsersIcon,
} from '@heroicons/react/24/outline';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import {
    deleteCampaign,
    dispatchCampaignNext,
    getCampaignFailures,
    getCampaigns,
    getHelpdeskQueues,
    getLeadAnalytics,
    getMessages,
    retryCampaignFailures,
    retryMessage,
    updateCampaign,
    updateMessage,
} from '../utils/api.js';
import { connectRealtime } from '../utils/realtime.js';
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
    const [editingCampaign, setEditingCampaign] = useState(null);
    const [savingCampaignEdit, setSavingCampaignEdit] = useState(false);
    const [campaignEditForm, setCampaignEditForm] = useState({
        name: '',
        messageTemplate: '',
        messageVariants: [],
        minDelaySeconds: 0,
        maxDelaySeconds: 120,
    });
    const [glassMode, setGlassMode] = useState(getStoredGlassMode);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [failures, setFailures] = useState([]);
    const [loadingFailures, setLoadingFailures] = useState(false);
    const [savingMessageId, setSavingMessageId] = useState(null);
    const [retryingMessageId, setRetryingMessageId] = useState(null);
    const [retryingAllFailures, setRetryingAllFailures] = useState(false);
    const [messageEdits, setMessageEdits] = useState({});
    const [leadAnalytics, setLeadAnalytics] = useState(null);
    const [helpdeskSummary, setHelpdeskSummary] = useState(null);
    const [liveActivity, setLiveActivity] = useState(null);
    const [countdown, setCountdown] = useState(0);
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
            const leads = await getLeadAnalytics().catch(() => null);
            setLeadAnalytics(leads || null);
            const helpdesk = await getHelpdeskQueues({ limit: 50 }).catch(() => null);
            setHelpdeskSummary(helpdesk?.summary || null);
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
                
                if (eventName === 'bot.live_activity') {
                    const payload = message.payload || {};
                    const normalizedActivity = String(payload.activity || '').trim().toLowerCase();
                    setLiveActivity({
                        ...payload,
                        activity: normalizedActivity || 'processing',
                        data: payload.data || {},
                    });
                    if (normalizedActivity === 'waiting' && payload.data?.nextSendAt) {
                        const remaining = Math.max(0, Math.round((payload.data.nextSendAt - Date.now()) / 1000));
                        setCountdown(remaining);
                    } else {
                        setCountdown(0);
                    }
                    return;
                }

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
        if (!countdown || countdown <= 0) return undefined;
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [countdown]);
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
    const helpdeskCards = useMemo(() => {
        const total = Number(helpdeskSummary?.total || 0);
        const waiting = Number(helpdeskSummary?.waiting || 0);
        const inAttendance = Number(helpdeskSummary?.inAttendance || 0);
        const monitoring = Number(helpdeskSummary?.monitoring || 0);
        const protocolsOpen = Number(helpdeskSummary?.protocolsOpen || 0);
        return {
            total,
            waiting,
            inAttendance,
            monitoring,
            protocolsOpen,
            active: waiting + inAttendance + monitoring,
        };
    }, [helpdeskSummary]);
    const helpdeskChartData = useMemo(() => (helpdeskSummary ? [
        { name: 'Fila', value: Number(helpdeskSummary.waiting || 0), color: '#f68b2c' },
        { name: 'Atendimento', value: Number(helpdeskSummary.inAttendance || 0), color: '#0f5ea8' },
        { name: 'Monitoria', value: Number(helpdeskSummary.monitoring || 0), color: '#21a366' },
    ] : []), [helpdeskSummary]);
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
    const handleDispatchCampaign = useCallback(async (campaign) => {
        if (!campaign?._id) return;
        if (Number(campaign?.pending || 0) <= 0) return;
        try {
            setDispatchingCampaignId(campaign._id);
            await dispatchCampaignNext(campaign._id);
            await loadDashboardData({ showSpinner: false });
        } catch (error) {
            console.error('Dispatch next contact error:', error);
            alert('Nao foi possivel disparar o proximo contato da fila.');
        } finally {
            setDispatchingCampaignId(null);
        }
    }, []);
    const openCampaignEditModal = useCallback((campaign) => {
        if (!campaign?._id) return;
        setEditingCampaign(campaign);
        setCampaignEditForm({
            name: String(campaign.name || ''),
            messageTemplate: String(campaign.messageTemplate || ''),
            messageVariants: Array.isArray(campaign.messageVariants) ? [...campaign.messageVariants] : [],
            minDelaySeconds: Number(campaign?.antiBan?.minDelaySeconds || 0),
            maxDelaySeconds: Number(campaign?.antiBan?.maxDelaySeconds || 120),
        });
    }, []);
    const closeCampaignEditModal = useCallback(() => {
        setEditingCampaign(null);
        setSavingCampaignEdit(false);
    }, []);
    const saveCampaignEdit = useCallback(async () => {
        if (!editingCampaign?._id) return;
        const minDelaySeconds = Number(campaignEditForm.minDelaySeconds);
        const maxDelaySeconds = Number(campaignEditForm.maxDelaySeconds);
        if (!campaignEditForm.name.trim()) {
            alert('Informe o nome da campanha.');
            return;
        }
        if (!Number.isFinite(minDelaySeconds) || !Number.isFinite(maxDelaySeconds) || minDelaySeconds < 0 || maxDelaySeconds < 0 || minDelaySeconds > maxDelaySeconds) {
            alert('Revise os valores de anti-ban.');
            return;
        }
        try {
            setSavingCampaignEdit(true);
            await updateCampaign(editingCampaign._id, {
                name: campaignEditForm.name.trim(),
                messageTemplate: campaignEditForm.messageTemplate,
                  messageVariants: campaignEditForm.messageVariants,
                  antiBan: {
                    ...(editingCampaign?.antiBan || {}),
                    minDelaySeconds,
                    maxDelaySeconds,
                },
            });
            await loadDashboardData({ showSpinner: false });
            closeCampaignEditModal();
        } catch (error) {
            console.error('Update campaign error:', error);
            alert('Nao foi possivel salvar a campanha.');
        } finally {
            setSavingCampaignEdit(false);
        }
    }, [editingCampaign, campaignEditForm, loadDashboardData, closeCampaignEditModal]);
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
        setRetryingAllFailures(false);
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
    const handleRetryAllFailures = async () => {
        if (!selectedCampaign?._id || failures.length === 0) return;
        const confirmed = window.confirm(`Reenfileirar todas as ${failures.length} falhas desta campanha?`);
        if (!confirmed) return;
        try {
            setRetryingAllFailures(true);
            const result = await retryCampaignFailures(selectedCampaign._id);
            const retriedCount = Number(result?.retriedCount || 0);
            setFailures([]);
            setMessageEdits({});
            await loadDashboardData({ showSpinner: false });
            alert(`${retriedCount} mensagem(ns) reenfileirada(s) com sucesso.`);
        } catch (error) {
            console.error('Bulk retry message error:', error);
            alert('Nao foi possivel reenfileirar todas as falhas.');
        } finally {
            setRetryingAllFailures(false);
        }
    };
    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-300 shadow-sm">
                <ArrowPathIcon className="w-4 h-4 animate-spin text-orange-300" />
                <span>Carregando dados...</span>
            </div>
        );
    }
    const panelClass = glassMode
        ? 'rounded-[24px] border border-white/10 bg-slate-950/86 shadow-[0_28px_65px_-42px_rgba(0,0,0,0.8)] backdrop-blur-2xl'
        : 'rounded-xl border border-white/10 bg-slate-950/92 shadow-sm';
    const heroMetricClass = glassMode
        ? 'rounded-xl border border-white/10 bg-slate-900/70 p-4 backdrop-blur-xl'
        : 'rounded-xl border border-white/10 bg-slate-900/88 p-4';
    const neutralButtonClass = glassMode
        ? 'inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/75 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800'
        : 'inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800';
    const accentButtonClass = glassMode
        ? 'inline-flex items-center gap-2 rounded-xl border border-orange-400/30 bg-gradient-to-r from-orange-500 to-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:from-orange-400 hover:to-amber-300'
        : 'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:from-orange-400 hover:to-amber-300';
    const inputClass = glassMode
        ? 'w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none backdrop-blur focus:border-orange-400'
        : 'w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400';
    const tableHeadClass = glassMode
        ? 'bg-slate-900/70 text-slate-300'
        : 'bg-slate-900 text-slate-300';
    const quickFilterBase = glassMode
        ? 'rounded-full border border-white/10 bg-slate-900/75 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800'
        : 'rounded-full border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800';
    const quickFilterActive = glassMode
        ? 'border-orange-400/40 bg-orange-500/20 text-orange-200'
        : 'border-orange-400/40 bg-orange-500/20 text-orange-200';
    const realtimeLabel = realtimeStatus === 'connected'
        ? `Tempo real ativo${lastRealtimeAt ? ` (${new Date(lastRealtimeAt).toLocaleTimeString()})` : ''}`
        : realtimeStatus === 'connecting'
            ? 'Conectando websocket...'
            : 'Fallback ativo por intervalo';
    const realtimeClass = realtimeStatus === 'connected'
        ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
        : realtimeStatus === 'connecting'
            ? 'border-blue-400/20 bg-blue-500/10 text-blue-300'
            : 'border-orange-400/20 bg-orange-500/10 text-orange-200';
    const liveActivityType = String(liveActivity?.activity || '').trim().toLowerCase();
    return (
        <>
            <div className={`campaigns-page crm-campaigns space-y-6 ${glassMode ? 'campaigns-page--glass' : ''}`}>
                <section className={`${panelClass} p-5 md:p-6`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-300">Operations</p>
                            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-50">Painel de Campanhas</h2>
                            <p className="mt-1 text-sm text-slate-400">Fluxo de envio, falhas e produtividade em uma visao executiva unica.</p>
                            
                            {/* Live Activity Feed */}
                            <div className="mt-4 flex flex-col md:flex-row md:items-center gap-3">
                                {liveActivity && (
                                    <div className={`inline-flex items-center gap-3 px-4 py-1.5 rounded-2xl border backdrop-blur-md shadow-sm transition-all duration-300 ${
                                        liveActivityType === 'typing' ? 'bg-blue-500/10 border-blue-400/20 text-blue-200 animate-pulse' :
                                        liveActivityType === 'waiting' ? 'bg-orange-500/10 border-orange-400/20 text-orange-200' :
                                        liveActivityType === 'sending' ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200' :
                                        'bg-slate-900/70 border-white/10 text-slate-300'
                                    }`}>
                                        <div className="relative">
                                            <div className={`h-2 w-2 rounded-full ${
                                                liveActivityType === 'typing' ? 'bg-blue-400' :
                                                liveActivityType === 'waiting' ? 'bg-orange-400' :
                                                liveActivityType === 'sending' ? 'bg-emerald-400' :
                                                'bg-slate-400'
                                            }`} />
                                            {liveActivityType === 'typing' && (
                                                <div className="absolute inset-0 h-2 w-2 rounded-full bg-sky-500 animate-ping" />
                                            )}
                                        </div>
                                        <span className="text-xs font-semibold">
                                            {liveActivityType === 'typing' && `Robô está digitando para ${liveActivity.data?.text || 'contato'}...`}
                                            {liveActivityType === 'waiting' && (
                                                countdown > 0 
                                                    ? `Anti-ban: Próximo envio em ${countdown}s`
                                                    : `Aguardando início do próximo envio...`
                                            )}
                                            {liveActivityType === 'sending' && `Enviando mensagem agora...`}
                                            {liveActivityType === 'processing' && `Processando fila de mensagens...`}
                                            {!['typing', 'waiting', 'sending', 'processing'].includes(liveActivityType) && `Atividade do robô em execução...`}
                                        </span>
                                    </div>
                                )}
                                {!liveActivity && (
                                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-2xl bg-slate-900/70 border border-white/10 text-slate-400 text-[11px] italic">
                                        <ClockIcon className="w-3.5 h-3.5" />
                                        Aguardando atividade do robô...
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setGlassMode((prev) => !prev)}
                                className={neutralButtonClass}
                            >
                                <SparklesIcon className="w-4 h-4" />
                                {glassMode ? 'Apple Glass ON' : 'Apple Glass OFF'}
                            </button>
                            <button
                                type="button"
                                onClick={exportCampaignsCsv}
                                className={neutralButtonClass}
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                Exportar CSV
                            </button>
                            <button
                                type="button"
                                onClick={loadDashboardData}
                                disabled={syncing}
                                className={`${accentButtonClass} ${syncing ? 'cursor-wait opacity-80' : ''}`}
                            >
                                <ArrowPathIcon className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
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
                            <span className="text-slate-400">
                            Ultima sincronizacao: {lastSyncAt ? lastSyncAt.toLocaleTimeString() : '-'}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${realtimeClass}`}>
                            {realtimeLabel}
                        </span>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-8">
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Enviadas</span>
                                <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.sent}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Taxa sucesso</span>
                                <ArrowPathIcon className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.successRate}%</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Na fila</span>
                                <ClockIcon className="w-4 h-4 text-amber-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.pending}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Falhas</span>
                                <ExclamationTriangleIcon className="w-4 h-4 text-red-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.failed}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Criticas</span>
                                <ExclamationTriangleIcon className="w-4 h-4 text-orange-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.critical}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Contatos</span>
                                <ArrowPathIcon className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{totals.contacts}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Leads qualif.</span>
                                <ArrowPathIcon className="w-4 h-4 text-cyan-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{leadAnalytics?.byStage?.qualified || 0}</div>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Conv. leads</span>
                                <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{leadAnalytics?.conversion?.wonRate || 0}%</div>
                        </div>
                    </div>
                </section>
                <section className={`${panelClass} p-5 md:p-6`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">Servicos</p>
                            <h3 className="mt-1 text-xl font-bold text-slate-50">Gestao de Atendimento</h3>
                            <p className="mt-1 text-sm text-slate-400">Fila, protocolos abertos e distribuicao operacional em tempo real.</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-300">
                            Base helpdesk
                        </span>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Atendimentos</span>
                                <UsersIcon className="w-4 h-4 text-orange-300" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{helpdeskCards.total}</div>
                            <p className="mt-1 text-xs text-slate-400">Total em fila e em acompanhamento.</p>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Aguardando</span>
                                <ClockIcon className="w-4 h-4 text-orange-300" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{helpdeskCards.waiting}</div>
                            <p className="mt-1 text-xs text-slate-400">Pendentes de atendimento humano.</p>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Em atendimento</span>
                                <ArrowPathIcon className="w-4 h-4 text-blue-300" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{helpdeskCards.inAttendance}</div>
                            <p className="mt-1 text-xs text-slate-400">Conversas ativas no suporte.</p>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Protocolos</span>
                                <ExclamationTriangleIcon className="w-4 h-4 text-amber-300" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{helpdeskCards.protocolsOpen}</div>
                            <p className="mt-1 text-xs text-slate-400">Casos em aberto ou acompanhamento.</p>
                        </div>
                        <div className={heroMetricClass}>
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                                <span>Monitoria</span>
                                <CheckCircleIcon className="w-4 h-4 text-emerald-300" />
                            </div>
                            <div className="mt-2 text-2xl font-bold text-slate-50">{helpdeskCards.monitoring}</div>
                            <p className="mt-1 text-xs text-slate-400">Conversa observada sem intervenção.</p>
                        </div>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-slate-50">Distribuicao da fila</h4>
                                <span className="text-xs text-slate-400">Ativo: {helpdeskCards.active}</span>
                            </div>
                            <div className="h-64 min-h-64 overflow-hidden">
                                {helpdeskChartData.length === 0 ? (
                                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-400">
                                        Sem dados de atendimento.
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={240} minWidth={0} debounce={120}>
                                        <BarChart data={helpdeskChartData} margin={{ top: 6, right: 8, bottom: 6, left: -8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                                            <YAxis tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                                contentStyle={{
                                                    background: '#0f1724',
                                                    border: '1px solid rgba(255,255,255,0.12)',
                                                    borderRadius: 16,
                                                    color: '#f4f7fb',
                                                }}
                                                labelStyle={{ color: '#f4f7fb' }}
                                            />
                                            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                                                {helpdeskChartData.map((entry) => (
                                                    <Cell key={entry.name} fill={entry.color} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                            <h4 className="text-sm font-semibold text-slate-50">Leitura gerencial</h4>
                            <ul className="mt-3 space-y-3 text-sm text-slate-300">
                                <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
                                    <span>Backlog atual</span>
                                    <strong className="text-slate-50">{helpdeskCards.waiting + helpdeskCards.inAttendance}</strong>
                                </li>
                                <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
                                    <span>Relação fila/monitoria</span>
                                    <strong className="text-slate-50">{helpdeskCards.monitoring > 0 ? `${Math.round(((helpdeskCards.waiting + helpdeskCards.inAttendance) / helpdeskCards.monitoring) * 100) / 100}:1` : 'N/D'}</strong>
                                </li>
                                <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
                                    <span>Saúde operacional</span>
                                    <strong className={helpdeskCards.waiting > helpdeskCards.inAttendance ? 'text-orange-300' : 'text-emerald-300'}>{helpdeskCards.waiting > helpdeskCards.inAttendance ? 'Carga alta' : 'Estável'}</strong>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>
                <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className={`${panelClass} p-5 lg:col-span-1`}>
                        <h3 className="text-base font-semibold text-slate-50">Resumo operacional</h3>
                        <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                                <span className="text-slate-400">Executando</span>
                                <span className="font-bold text-slate-50">{totals.running}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                                <span className="text-slate-400">Com falha</span>
                                <span className="font-bold text-slate-50">{totals.withFailures}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                                <span className="text-slate-400">Respostas</span>
                                <span className="font-bold text-slate-50">{totals.replies}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm">
                                <span className="text-slate-400">Conclusao media</span>
                                <span className="font-bold text-slate-50">{totals.completionRate}%</span>
                            </div>
                        </div>
                    </div>
                    <div className={`${panelClass} p-5 lg:col-span-2`}>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-slate-50">Performance</h3>
                            <span className="text-xs text-slate-400">Top 8 campanhas filtradas</span>
                        </div>
                        <div className="h-64 min-h-64 min-w-0 overflow-hidden">
                            {chartData.length === 0 ? (
                                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-400">
                                    Sem dados para os filtros selecionados.
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={240} minWidth={0} debounce={120}>
                                    <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 6, left: -8 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                                        <YAxis tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                            contentStyle={{
                                                background: '#0f1724',
                                                border: '1px solid rgba(255,255,255,0.12)',
                                                borderRadius: 16,
                                                color: '#f4f7fb',
                                            }}
                                            labelStyle={{ color: '#f4f7fb' }}
                                        />
                                        <Bar dataKey="enviados" fill="#21a366" radius={[8, 8, 0, 0]} />
                                        <Bar dataKey="falhas" fill="#f68b2c" radius={[8, 8, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </section>
                <section className={`${panelClass} overflow-hidden`}>
                    <div className="border-b border-white/10 px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-50">Campanhas</h3>
                                <p className="text-xs text-slate-400">{filteredCampaigns.length} de {campaignRows.length} exibidas.</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative min-w-55">
                                    <MagnifyingGlassIcon className="w-4 h-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Buscar campanha..."
                                        className={`${inputClass} pl-9`}
                                    />
                                </div>
                                <div className="inline-flex items-center gap-2">
                                    {/* Filtro: pode-se usar um ícone de ajuste se desejar, mas Heroicons não tem SlidersHorizontal. Pode-se omitir ou usar AdjustmentsHorizontalIcon se disponível. */}
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
                        <table className="campaigns-table w-full min-w-245 text-left text-sm">
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
                                        <td colSpan="7" className="px-5 py-10 text-center text-sm text-slate-400">
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
                                        <tr key={campaign._id} className="border-t border-white/10 align-top">
                                            <td className="px-5 py-4">
                                                <div className="font-semibold text-slate-50">{campaign.name}</div>
                                                <div className="mt-1 text-xs text-slate-400">Enviadas: {campaign.sent} | Falhas: {campaign.failed}</div>
                                                {critical && (
                                                    <span className="mt-2 inline-flex rounded-full bg-orange-500/10 px-2 py-1 text-[11px] font-semibold text-orange-200 border border-orange-400/20">
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
                                                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                                                    <span>{campaign.sent + campaign.failed}/{campaign.total}</span>
                                                    <span>{campaign.progress}%</span>
                                                </div>
                                                <div className="h-2 rounded-full bg-slate-800">
                                                    <div className={`h-2 rounded-full ${progressBarClass}`} style={{ width: `${campaign.progress}%` }} />
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="text-sm font-semibold text-slate-50">{campaign.pending}</div>
                                                <div className="text-xs text-slate-400">pendente(s)</div>
                                            </td>
                                            <td className="px-5 py-4 text-slate-300">
                                                {Number(campaign?.antiBan?.minDelaySeconds || 0)}s - {Number(campaign?.antiBan?.maxDelaySeconds || 0)}s
                                            </td>
                                            <td className="px-5 py-4 text-xs text-slate-400">{formatDate(campaign.createdAt)}</td>
                                            <td className="px-5 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDispatchCampaign(campaign)}
                                                        disabled={dispatchingCampaignId === campaign._id || campaign.pending <= 0}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                                            dispatchingCampaignId === campaign._id
                                                                ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                                                                : campaign.pending <= 0
                                                                    ? 'cursor-not-allowed bg-slate-700 text-slate-500'
                                                                    : 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-slate-950 hover:from-emerald-400 hover:to-emerald-300'
                                                        }`}
                                                    >
                                                        <CheckCircleIcon className="w-4 h-4" />
                                                        {dispatchingCampaignId === campaign._id ? 'Disparando...' : 'Proximo imediato'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openCampaignEditModal(campaign)}
                                                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20 border border-blue-400/20"
                                                    >
                                                        <PencilIcon className="w-4 h-4" />
                                                        Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openFailuresModal(campaign)}
                                                        disabled={campaign.failed === 0}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${campaign.failed === 0 ? 'cursor-not-allowed bg-slate-700 text-slate-500' : 'bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 border border-orange-400/20'}`}
                                                    >
                                                        <ExclamationTriangleIcon className="w-4 h-4" />
                                                        Falhas ({campaign.failed})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteCampaign(campaign)}
                                                        disabled={deletingId === campaign._id}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${deletingId === campaign._id ? 'cursor-not-allowed bg-slate-700 text-slate-500' : 'bg-red-500/10 text-red-200 hover:bg-red-500/20 border border-red-400/20'}`}
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
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
                    <div className="border-b border-white/10 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-50">Atividade recente</h3>
                        <p className="text-xs text-slate-400">Ultimos 10 eventos de envio.</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {recentActivity.length === 0 ? (
                            <div className="px-5 py-6 text-sm text-slate-400">Nenhuma atividade recente encontrada.</div>
                        ) : recentActivity.map((item) => (
                            <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-slate-100">{item.name || item.phone || 'Contato sem nome'}</div>
                                    <div className="truncate text-xs text-slate-400">{item.processedMessage || 'Sem texto'}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'sent' ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-400/20' : item.status === 'failed' ? 'bg-red-500/10 text-red-200 border border-red-400/20' : 'bg-slate-800 text-slate-200 border border-white/10'}`}>
                                        {item.status || 'pending'}
                                    </span>
                                    <span className="text-xs text-slate-400">{formatDate(item.updatedAt || item.sentAt || item.createdAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
            {selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md">
                    <div className={`flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl ${glassMode ? 'rounded-3xl border border-white/10 bg-slate-950/96 backdrop-blur-2xl' : 'rounded-xl bg-slate-950/96'}`}>
                        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-50">Falhas da Campanha</h3>
                                <p className="text-sm text-slate-400">{selectedCampaign.name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleRetryAllFailures}
                                    disabled={loadingFailures || failures.length === 0 || retryingAllFailures}
                                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-950 transition ${loadingFailures || failures.length === 0 || retryingAllFailures ? 'cursor-not-allowed bg-slate-700 text-slate-500' : 'bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300'}`}
                                >
                                    <ArrowPathIcon className={`w-4 h-4 ${retryingAllFailures ? 'animate-spin' : ''}`} />
                                    {retryingAllFailures ? 'Reenfileirando...' : 'Reenfileirar todas'}
                                </button>
                                <button
                                    type="button"
                                    onClick={closeFailuresModal}
                                    className={neutralButtonClass}
                                >
                                    <XMarkIcon className="w-4 h-4" />
                                    Fechar
                                </button>
                            </div>
                        </div>
                        <div className="overflow-y-auto p-6">
                            {loadingFailures ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-center text-sm text-slate-400">
                                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                    <span>Carregando falhas...</span>
                                </div>
                            ) : failures.length === 0 ? (
                                <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                                    Nenhuma falha pendente para auditoria.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {failures.map((item) => {
                                        const edit = messageEdits[item._id] || {};
                                        const isSaving = savingMessageId === item._id;
                                        const isRetrying = retryingMessageId === item._id;
                                        return (
                                            <div key={item._id} className={`rounded-lg border p-4 ${glassMode ? 'border-white/10 bg-slate-900/80 shadow-sm backdrop-blur' : 'border-white/10 bg-slate-900 shadow-sm'}`}>
                                                <div className="mb-2 text-xs text-red-300">Motivo: {item.lastError || item.error || 'Erro nao informado'}</div>
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
                                                        className={`rounded-md px-3 py-1.5 text-xs font-semibold text-slate-950 ${isSaving || isRetrying ? 'cursor-not-allowed bg-slate-700 text-slate-500' : 'bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-400 hover:to-cyan-300'}`}
                                                    >
                                                        {isSaving ? 'Salvando...' : 'Salvar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRetryMessage(item._id)}
                                                        disabled={isSaving || isRetrying}
                                                        className={`rounded-md px-3 py-1.5 text-xs font-semibold text-slate-950 ${isSaving || isRetrying ? 'cursor-not-allowed bg-slate-700 text-slate-500' : 'bg-gradient-to-r from-orange-500 to-amber-400 hover:from-orange-400 hover:to-amber-300'}`}
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
            {editingCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md">
                    <div className={`w-full max-w-3xl overflow-hidden shadow-2xl ${glassMode ? 'rounded-3xl border border-white/10 bg-slate-950/96 backdrop-blur-2xl' : 'rounded-xl bg-slate-950/96'}`}>
                        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-50">Editar campanha</h3>
                                <p className="text-sm text-slate-400">{editingCampaign.name}</p>
                            </div>
                            <button type="button" onClick={closeCampaignEditModal} className={neutralButtonClass}>
                                <XMarkIcon className="w-4 h-4" />
                                Fechar
                            </button>
                        </div>
                        <div className="space-y-4 p-6">
                            <input
                                type="text"
                                value={campaignEditForm.name}
                                onChange={(e) => setCampaignEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder="Nome da campanha"
                                className={inputClass}
                            />
                            {editingCampaign?.turboMode || (campaignEditForm.messageVariants && campaignEditForm.messageVariants.length > 0) ? (
                                  <div className="space-y-3">
                                      <p className="text-sm font-semibold text-orange-200">Variações de Mensagens (Modo Turbo)</p>
                                      {campaignEditForm.messageVariants.map((variant, index) => (
                                          <div key={index} className="flex flex-col gap-1">
                                              <label className="text-xs text-slate-400">Variação {index + 1}</label>
                                              <textarea
                                                  rows="3"
                                                  value={variant}
                                                  onChange={(e) => {
                                                      const newVariants = [...campaignEditForm.messageVariants];
                                                      newVariants[index] = e.target.value;
                                                      setCampaignEditForm(prev => ({ ...prev, messageVariants: newVariants }));
                                                  }}
                                                  className={`${inputClass} resize-y bg-slate-950 border-white/10 text-slate-100 p-3 rounded-xl w-full focus:outline-none focus:border-orange-400/50`}
                                              />
                                          </div>
                                      ))}
                                  </div>
                              ) : (
                                  <textarea
                                      rows="4"
                                      value={campaignEditForm.messageTemplate}
                                      onChange={(e) => setCampaignEditForm((prev) => ({ ...prev, messageTemplate: e.target.value }))}
                                      placeholder="Mensagem base"
                                      className={`${inputClass} resize-y`}
                                  />
                              )}
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={campaignEditForm.minDelaySeconds}
                                    onChange={(e) => setCampaignEditForm((prev) => ({ ...prev, minDelaySeconds: e.target.value }))}
                                    className={inputClass}
                                    placeholder="Min delay (s)"
                                />
                                <input
                                    type="number"
                                    min="0"
                                    value={campaignEditForm.maxDelaySeconds}
                                    onChange={(e) => setCampaignEditForm((prev) => ({ ...prev, maxDelaySeconds: e.target.value }))}
                                    className={inputClass}
                                    placeholder="Max delay (s)"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={closeCampaignEditModal} className={neutralButtonClass}>
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={saveCampaignEdit}
                                    disabled={savingCampaignEdit}
                                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white ${savingCampaignEdit ? 'cursor-not-allowed bg-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                >
                                    <CheckCircleIcon className="w-4 h-4" />
                                    {savingCampaignEdit ? 'Salvando...' : 'Salvar campanha'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
export default Campaigns;
