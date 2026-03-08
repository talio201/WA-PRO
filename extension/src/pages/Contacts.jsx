import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw, Search, Users } from 'lucide-react';
import { getMessages } from '../utils/api';
import { connectRealtime } from '../utils/realtime';

const CONTACTS_FALLBACK_REFRESH_INTERVAL_MS = 60000;

const formatDateTime = (value) => {
    if (!value) return '-';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';

    return parsed.toLocaleString();
};

const Contacts = () => {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [realtimeStatus, setRealtimeStatus] = useState('connecting');
    const [lastSyncAt, setLastSyncAt] = useState(null);

    const syncInFlightRef = useRef(false);
    const realtimeReloadTimerRef = useRef(null);

    const loadMessages = useCallback(async (options = {}) => {
        const showLoading = options.showLoading === true;
        if (syncInFlightRef.current) return;

        syncInFlightRef.current = true;
        if (showLoading) {
            setLoading(true);
        }

        try {
            const data = await getMessages({ limit: 5000 });
            setMessages(data || []);
            setLastSyncAt(new Date());
        } catch (error) {
            console.error('Failed to load contacts:', error);
        } finally {
            setLoading(false);
            syncInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        loadMessages({ showLoading: true });
    }, [loadMessages]);

    useEffect(() => {
        const disposeRealtime = connectRealtime({
            onStatus: (status) => {
                setRealtimeStatus(status);
            },
            onEvent: (message) => {
                const eventName = String(message?.event || '');
                const shouldRefresh = eventName.startsWith('messages.')
                    || eventName.startsWith('campaign.')
                    || eventName.startsWith('conversation.assignment');

                if (!shouldRefresh) return;

                if (realtimeReloadTimerRef.current) {
                    clearTimeout(realtimeReloadTimerRef.current);
                }

                realtimeReloadTimerRef.current = setTimeout(() => {
                    realtimeReloadTimerRef.current = null;
                    loadMessages({ showLoading: false });
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
    }, [loadMessages]);

    useEffect(() => {
        if (realtimeStatus === 'connected') return undefined;

        const interval = setInterval(() => {
            loadMessages({ showLoading: false });
        }, CONTACTS_FALLBACK_REFRESH_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [realtimeStatus, loadMessages]);

    const contacts = useMemo(() => {
        const grouped = new Map();

        messages.forEach((message) => {
            const phone = message.phone;
            if (!phone) return;

            const existing = grouped.get(phone) || {
                phone,
                name: message.name || message.phoneOriginal || phone,
                sentCount: 0,
                failedCount: 0,
                totalMessages: 0,
                lastStatus: message.status || 'pending',
                lastAt: message.updatedAt || message.sentAt || message.createdAt,
            };

            existing.totalMessages += 1;
            if (message.status === 'sent') existing.sentCount += 1;
            if (message.status === 'failed') existing.failedCount += 1;

            const currentDate = new Date(existing.lastAt || 0).getTime();
            const nextDate = new Date(message.updatedAt || message.sentAt || message.createdAt || 0).getTime();
            if (nextDate >= currentDate) {
                existing.lastAt = message.updatedAt || message.sentAt || message.createdAt;
                existing.lastStatus = message.status || existing.lastStatus;
                existing.name = message.name || existing.name;
            }

            grouped.set(phone, existing);
        });

        let list = Array.from(grouped.values()).sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));

        if (filter === 'failed') {
            list = list.filter((item) => item.failedCount > 0);
        }

        if (filter === 'healthy') {
            list = list.filter((item) => item.failedCount === 0 && item.sentCount > 0);
        }

        const query = search.trim().toLowerCase();
        if (query) {
            list = list.filter((item) => (
                String(item.name || '').toLowerCase().includes(query)
                || String(item.phone || '').toLowerCase().includes(query)
            ));
        }

        return list;
    }, [messages, filter, search]);

    const totalContacts = contacts.length;
    const realtimeLabel = realtimeStatus === 'connected'
        ? `Tempo real ativo${lastSyncAt ? ` (${lastSyncAt.toLocaleTimeString()})` : ''}`
        : realtimeStatus === 'connecting'
            ? 'Conectando websocket...'
            : 'Fallback ativo por intervalo';

    const realtimeClass = realtimeStatus === 'connected'
        ? 'contacts-realtime contacts-realtime--connected'
        : realtimeStatus === 'connecting'
            ? 'contacts-realtime contacts-realtime--connecting'
            : 'contacts-realtime contacts-realtime--fallback';

    return (
        <div className="contacts-page contacts-page--glass space-y-5">
            <section className="contacts-panel p-5 md:p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="space-y-1">
                        <p className="contacts-eyebrow">CRM Glass</p>
                        <h3 className="text-2xl font-bold tracking-tight text-slate-900">Contatos</h3>
                        <p className="text-sm text-slate-600">Base montada a partir das mensagens processadas</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="contacts-stat-chip">
                            <Users size={15} />
                            <span>{totalContacts} contatos</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => loadMessages({ showLoading: false })}
                            className="contacts-refresh-button"
                        >
                            <RefreshCw size={13} />
                            Atualizar
                        </button>
                    </div>
                </div>

                <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${realtimeClass}`}>
                    <Activity size={12} />
                    {realtimeLabel}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className={`contacts-filter-chip ${filter === 'all' ? 'contacts-filter-chip--active' : ''}`}
                    >
                        Todos
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('healthy')}
                        className={`contacts-filter-chip ${filter === 'healthy' ? 'contacts-filter-chip--active' : ''}`}
                    >
                        Sem Falhas
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('failed')}
                        className={`contacts-filter-chip ${filter === 'failed' ? 'contacts-filter-chip--active' : ''}`}
                    >
                        Com Falhas
                    </button>

                    <label className="contacts-search-field ml-auto min-w-[240px]">
                        <Search size={14} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar contato"
                        />
                    </label>
                </div>
            </section>

            <section className="contacts-panel contacts-table-panel overflow-hidden">
                {loading ? (
                    <div className="px-6 py-10 text-sm text-slate-600">Carregando contatos...</div>
                ) : contacts.length === 0 ? (
                    <div className="px-6 py-10 text-sm text-slate-600">Nenhum contato encontrado para esse filtro.</div>
                ) : (
                    <div className="contacts-table-wrap overflow-x-auto">
                        <table className="contacts-table w-full text-left text-sm text-slate-700">
                            <thead className="contacts-table-head text-xs uppercase tracking-[0.12em] text-slate-700">
                                <tr>
                                    <th className="px-6 py-3">Nome</th>
                                    <th className="px-6 py-3">Numero</th>
                                    <th className="px-6 py-3">Enviadas</th>
                                    <th className="px-6 py-3">Falhas</th>
                                    <th className="px-6 py-3">Ultimo status</th>
                                    <th className="px-6 py-3">Ultima atividade</th>
                                </tr>
                            </thead>
                            <tbody>
                                {contacts.map((contact) => (
                                    <tr key={contact.phone} className="contacts-table-row">
                                        <td className="px-6 py-3 font-medium text-slate-900">{contact.name || '-'}</td>
                                        <td className="px-6 py-3 font-mono">{contact.phone}</td>
                                        <td className="px-6 py-3">{contact.sentCount}</td>
                                        <td className="px-6 py-3">{contact.failedCount}</td>
                                        <td className="px-6 py-3">
                                            <span className={`contacts-status-pill ${
                                                contact.lastStatus === 'sent'
                                                    ? 'contacts-status-pill--sent'
                                                    : contact.lastStatus === 'failed'
                                                        ? 'contacts-status-pill--failed'
                                                        : 'contacts-status-pill--pending'
                                            }`}>
                                                {contact.lastStatus || 'pending'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">{formatDateTime(contact.lastAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
};

export default Contacts;
