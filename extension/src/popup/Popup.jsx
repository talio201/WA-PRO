import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Play, Settings, Square, Wifi, WifiOff } from 'lucide-react';
import { getCampaigns } from '../utils/api';
import './popup-glass.css';

const DEFAULT_RUNTIME_STATE = {
    isActive: false,
    realtimeStatus: 'disconnected',
    isProcessingQueue: false,
    isManualSendInProgress: false,
    lastRealtimeEventAt: null,
};

const Popup = () => {
    const [isActive, setIsActive] = useState(false);
    const [stats, setStats] = useState({ sent: 0, pending: 0, running: 0 });
    const [runtimeState, setRuntimeState] = useState(DEFAULT_RUNTIME_STATE);

    const fetchStats = async () => {
        try {
            const campaigns = await getCampaigns();
            let sent = 0;
            let pending = 0;
            let running = 0;

            campaigns.forEach((campaign) => {
                sent += Number(campaign?.stats?.sent || 0);
                pending += Math.max(
                    Number(campaign?.stats?.total || 0)
                    - Number(campaign?.stats?.sent || 0)
                    - Number(campaign?.stats?.failed || 0),
                    0,
                );

                if (String(campaign?.status || '') === 'running') {
                    running += 1;
                }
            });

            setStats({ sent, pending, running });
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    const requestRuntimeState = () => {
        try {
            chrome.runtime.sendMessage({ action: 'GET_RUNTIME_STATE' }, (response) => {
                const runtimeError = chrome.runtime?.lastError;
                if (runtimeError) return;
                if (!response || !response.success) return;

                const payload = response.runtimeState || {};
                setRuntimeState((prev) => ({ ...prev, ...payload }));
                if (typeof payload.isActive === 'boolean') {
                    setIsActive(payload.isActive);
                }
            });
        } catch (error) {
            // Ignore runtime bridge failures.
        }
    };

    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.body.classList.add('popup-glass-body');
        }

        chrome.storage.local.get(['isActive'], (result) => {
            setIsActive(Boolean(result.isActive));
        });

        requestRuntimeState();
        fetchStats();

        const statsInterval = setInterval(fetchStats, 20000);
        const runtimeInterval = setInterval(requestRuntimeState, 5000);

        const onRuntimeMessage = (message) => {
            if (message?.action !== 'RUNTIME_STATE_UPDATE') return;
            const payload = message.runtimeState || {};

            setRuntimeState((prev) => ({ ...prev, ...payload }));
            if (typeof payload.isActive === 'boolean') {
                setIsActive(payload.isActive);
            }
        };

        chrome.runtime.onMessage.addListener(onRuntimeMessage);

        return () => {
            clearInterval(statsInterval);
            clearInterval(runtimeInterval);
            chrome.runtime.onMessage.removeListener(onRuntimeMessage);

            if (typeof document !== 'undefined') {
                document.body.classList.remove('popup-glass-body');
            }
        };
    }, []);

    const toggleStatus = () => {
        const nextState = !isActive;
        setIsActive(nextState);
        chrome.storage.local.set({ isActive: nextState });
        chrome.runtime.sendMessage({ action: 'TOGGLE_STATUS', value: nextState });
    };

    const openOptions = () => {
        chrome.runtime.openOptionsPage();
    };

    const runtimeBadge = useMemo(() => {
        const realtimeStatus = String(runtimeState.realtimeStatus || 'disconnected');

        if (realtimeStatus === 'connected') {
            return {
                className: 'is-online',
                label: 'WebSocket online',
                icon: <Wifi size={13} />,
            };
        }

        if (realtimeStatus === 'connecting') {
            return {
                className: 'is-connecting',
                label: 'Conectando realtime',
                icon: <Activity size={13} />,
            };
        }

        return {
            className: 'is-offline',
            label: 'WebSocket offline',
            icon: <WifiOff size={13} />,
        };
    }, [runtimeState.realtimeStatus]);

    const queueStateText = runtimeState.isManualSendInProgress
        ? 'Envio manual em andamento'
        : runtimeState.isProcessingQueue
            ? 'Fila processando agora'
            : isActive
                ? 'Fila pronta'
                : 'Fila pausada';

    return (
        <div className="popup-glass-root">
            <div className="popup-glass-ambient" aria-hidden="true">
                <div className="popup-blob popup-blob-a" />
                <div className="popup-blob popup-blob-b" />
            </div>

            <div className="popup-shell">
                <header className="popup-header">
                    <div>
                        <h1>WA Manager</h1>
                        <p>Mini Widget</p>
                    </div>

                    <button
                        type="button"
                        className="popup-icon-btn"
                        onClick={openOptions}
                        title="Configurações"
                    >
                        <Settings size={16} />
                    </button>
                </header>

                <div className={`popup-runtime-badge ${runtimeBadge.className}`}>
                    <span className="pulse-dot" />
                    {runtimeBadge.icon}
                    <span>{runtimeBadge.label}</span>
                </div>

                <main className="popup-main">
                    <section className="popup-card popup-card-hero">
                        <div>
                            <p className="muted">Estado do motor</p>
                            <h2>{isActive ? 'Sistema ativo' : 'Sistema pausado'}</h2>
                            <p className="small-muted">{queueStateText}</p>
                        </div>
                        <button
                            type="button"
                            className={`popup-primary-btn ${isActive ? 'stop' : 'start'}`}
                            onClick={toggleStatus}
                        >
                            {isActive ? (
                                <>
                                    <Square size={15} />
                                    Parar campanhas
                                </>
                            ) : (
                                <>
                                    <Play size={15} />
                                    Iniciar campanhas
                                </>
                            )}
                        </button>
                    </section>

                    <section className="popup-grid">
                        <article className="popup-card">
                            <p className="muted">Enviadas</p>
                            <strong>{stats.sent}</strong>
                        </article>
                        <article className="popup-card">
                            <p className="muted">Na fila</p>
                            <strong>{stats.pending}</strong>
                        </article>
                        <article className="popup-card">
                            <p className="muted">Campanhas</p>
                            <strong>{stats.running}</strong>
                        </article>
                        <article className="popup-card">
                            <p className="muted">Último evento</p>
                            <strong>{runtimeState.lastRealtimeEventAt ? new Date(runtimeState.lastRealtimeEventAt).toLocaleTimeString() : '-'}</strong>
                        </article>
                    </section>

                    <button type="button" className="popup-secondary-btn" onClick={openOptions}>
                        <BarChart3 size={14} />
                        Abrir painel completo
                    </button>
                </main>
            </div>
        </div>
    );
};

export default Popup;
