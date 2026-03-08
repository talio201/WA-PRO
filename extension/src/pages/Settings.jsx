import React, { useEffect, useMemo, useState } from 'react';
import './settings-glass.css';

const DEFAULT_SETTINGS = {
    enableHumanizedTyping: true,
    enableLongBreaks: true,
    enableRealtimeToasts: true,
    softBlurOnIsland: true,
    manualPreSendDelayMs: 700,
    agentBridgePhone: '',
    agentBridgeChatQuery: '',
};

const storageKeys = Object.keys(DEFAULT_SETTINGS);

const Settings = () => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        chrome.storage.local.get(storageKeys, (result) => {
            setSettings((prev) => ({
                ...prev,
                ...result,
            }));
            setLoading(false);
        });
    }, []);

    const persistSettings = (nextSettings) => {
        setSettings(nextSettings);
        chrome.storage.local.set(nextSettings);
    };

    const toggleSetting = (key) => {
        persistSettings({
            ...settings,
            [key]: !settings[key],
        });
    };

    const updateDelay = (value) => {
        const parsed = Math.max(100, Math.min(2500, Number(value) || 700));
        persistSettings({
            ...settings,
            manualPreSendDelayMs: parsed,
        });
    };

    const updateAgentBridgePhone = (value) => {
        const digits = String(value || '').replace(/\D/g, '');
        persistSettings({
            ...settings,
            agentBridgePhone: digits,
        });
    };

    const updateAgentBridgeChatQuery = (value) => {
        persistSettings({
            ...settings,
            agentBridgeChatQuery: String(value || ''),
        });
    };

    const statusLabel = useMemo(() => {
        if (loading) return 'Carregando configurações...';
        return 'Preferências salvas localmente';
    }, [loading]);

    return (
        <div className="settings-glass-root">
            <div className="settings-ambient" aria-hidden="true">
                <div className="settings-blob settings-blob-a" />
                <div className="settings-blob settings-blob-b" />
            </div>

            <div className="settings-shell">
                <header className="settings-header">
                    <div>
                        <h2>Controle fino da extensão</h2>
                        <p>{statusLabel}</p>
                    </div>
                </header>

                <section className="settings-grid">
                    <article className="settings-card">
                        <div>
                            <h3>Digitação humanizada</h3>
                            <p>Simula ritmo de escrita mais natural no envio.</p>
                        </div>
                        <button
                            type="button"
                            className={`glass-toggle ${settings.enableHumanizedTyping ? 'active' : ''}`}
                            onClick={() => toggleSetting('enableHumanizedTyping')}
                            aria-label="Alternar digitação humanizada"
                        />
                    </article>

                    <article className="settings-card">
                        <div>
                            <h3>Pausas longas anti-bot</h3>
                            <p>Insere pausas maiores entre blocos de disparos.</p>
                        </div>
                        <button
                            type="button"
                            className={`glass-toggle ${settings.enableLongBreaks ? 'active' : ''}`}
                            onClick={() => toggleSetting('enableLongBreaks')}
                            aria-label="Alternar pausas longas"
                        />
                    </article>

                    <article className="settings-card">
                        <div>
                            <h3>Toasts em tempo real</h3>
                            <p>Mostra notificações glass na interface do WhatsApp Web.</p>
                        </div>
                        <button
                            type="button"
                            className={`glass-toggle ${settings.enableRealtimeToasts ? 'active' : ''}`}
                            onClick={() => toggleSetting('enableRealtimeToasts')}
                            aria-label="Alternar toasts"
                        />
                    </article>

                    <article className="settings-card">
                        <div>
                            <h3>Blur no painel flutuante</h3>
                            <p>Desfoca o WhatsApp ao abrir a ilha de controle.</p>
                        </div>
                        <button
                            type="button"
                            className={`glass-toggle ${settings.softBlurOnIsland ? 'active' : ''}`}
                            onClick={() => toggleSetting('softBlurOnIsland')}
                            aria-label="Alternar blur no painel"
                        />
                    </article>

                </section>

                <section className="settings-input-card">
                    <label htmlFor="agent-bridge-chat">
                        <h3>Chat do agente (bridge)</h3>
                        <p>Nome da conversa/contato usado como ponte (ex: Backup (você)).</p>
                    </label>

                    <input
                        id="agent-bridge-chat"
                        type="text"
                        placeholder="Ex: Backup (você)"
                        value={settings.agentBridgeChatQuery || ''}
                        onChange={(event) => updateAgentBridgeChatQuery(event.target.value)}
                        className="settings-glass-input"
                    />
                </section>

                <section className="settings-input-card">
                    <label htmlFor="agent-bridge-phone">
                        <h3>Numero do agente (bridge)</h3>
                        <p>Opcional. Se preferir, informe o numero em vez do nome do chat (somente digitos).</p>
                    </label>

                    <input
                        id="agent-bridge-phone"
                        type="text"
                        inputMode="numeric"
                        placeholder="Ex: 5551999999999"
                        value={settings.agentBridgePhone || ''}
                        onChange={(event) => updateAgentBridgePhone(event.target.value)}
                        className="settings-glass-input"
                    />
                </section>

                <section className="settings-slider-card">
                    <div className="slider-head">
                        <h3>Atraso base pré-envio</h3>
                        <span>{settings.manualPreSendDelayMs} ms</span>
                    </div>

                    <input
                        type="range"
                        min="100"
                        max="2500"
                        step="50"
                        value={settings.manualPreSendDelayMs}
                        onChange={(event) => updateDelay(event.target.value)}
                        className="glass-range"
                    />

                    <div className="slider-foot">
                        <span>Rápido</span>
                        <span>Natural</span>
                        <span>Conservador</span>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Settings;
