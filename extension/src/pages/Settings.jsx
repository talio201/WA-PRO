import React, { useEffect, useMemo, useState } from 'react';
import './settings-glass.css';
import {
    DEFAULT_BACKEND_CONFIG,
    ensureInstallationRegistration,
    getRuntimeConfig,
    saveRuntimeConfig,
    syncActivationStatus,
} from '../utils/runtimeConfig';

const DEFAULT_SETTINGS = {
    enableHumanizedTyping: true,
    enableLongBreaks: true,
    enableRealtimeToasts: true,
    softBlurOnIsland: true,
    manualPreSendDelayMs: 700,
    agentBridgePhone: '',
    agentBridgeChatQuery: '',
    backendApiUrl: DEFAULT_BACKEND_CONFIG.backendApiUrl,
    backendWsUrl: DEFAULT_BACKEND_CONFIG.backendWsUrl,
    activationCode: '',
    licenseStatus: 'pending',
    planTerm: '',
    expiresAt: '',
};

const storageKeys = Object.keys(DEFAULT_SETTINGS);

function formatLicenseStatus(status) {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'active') return 'Ativa';
    if (normalized === 'expired') return 'Expirada';
    if (normalized === 'revoked') return 'Revogada';
    if (normalized === 'suspended') return 'Suspensa';
    return 'Pendente de ativação';
}

const Settings = () => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [syncingLicense, setSyncingLicense] = useState(false);

    useEffect(() => {
        chrome.storage.local.get(storageKeys, async (result) => {
            const merged = {
                ...DEFAULT_SETTINGS,
                ...result,
            };
            setSettings(merged);
            setLoading(false);
            await initializeActivation();
        });
    }, []);

    const initializeActivation = async () => {
        try {
            await ensureInstallationRegistration();
            const config = await getRuntimeConfig();
            const status = await syncActivationStatus();
            const nextSettings = {
                ...settings,
                activationCode: config.activationCode || '',
                licenseStatus: status?.status || config.licenseStatus || 'pending',
                planTerm: status?.planTerm || config.planTerm || '',
                expiresAt: status?.expiresAt || config.expiresAt || '',
            };
            persistSettings(nextSettings);
        } catch (error) {}
    };

    const persistSettings = async (nextSettings) => {
        setSettings(nextSettings);
        chrome.storage.local.set(nextSettings);
        await saveRuntimeConfig({
            backendApiUrl: nextSettings.backendApiUrl,
            backendWsUrl: nextSettings.backendWsUrl,
            activationCode: nextSettings.activationCode,
            licenseStatus: nextSettings.licenseStatus,
            planTerm: nextSettings.planTerm,
            expiresAt: nextSettings.expiresAt,
        });
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

    const updateBackendSetting = (key, value) => {
        persistSettings({
            ...settings,
            [key]: String(value || ''),
        });
    };

    const copyActivationCode = async () => {
        const code = String(settings.activationCode || '').trim();
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            window.alert('Código de ativação copiado.');
        } catch (error) {
            window.prompt('Copie o código de ativação:', code);
        }
    };

    const refreshLicense = async () => {
        setSyncingLicense(true);
        try {
            await ensureInstallationRegistration();
            const status = await syncActivationStatus();
            const runtime = await getRuntimeConfig();
            await persistSettings({
                ...settings,
                activationCode: runtime.activationCode || settings.activationCode,
                licenseStatus: status?.status || runtime.licenseStatus || 'pending',
                planTerm: status?.planTerm || runtime.planTerm || '',
                expiresAt: status?.expiresAt || runtime.expiresAt || '',
            });
        } catch (error) {
            window.alert(error?.message || 'Falha ao sincronizar licença.');
        } finally {
            setSyncingLicense(false);
        }
    };

    const statusLabel = useMemo(() => {
        if (loading) return 'Carregando configurações...';
        return 'Preferências salvas localmente';
    }, [loading]);

    const licenseLabel = useMemo(() => formatLicenseStatus(settings.licenseStatus), [settings.licenseStatus]);

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
                    <button
                        type="button"
                        className="glass-toggle active"
                        onClick={refreshLicense}
                        aria-label="Sincronizar licença"
                    >
                        {syncingLicense ? '...' : '↻'}
                    </button>
                </header>

                <section className="settings-input-card">
                    <label>
                        <h3>Código único da extensão</h3>
                        <p>Envie este código ao administrador para ativação e liberação da licença.</p>
                    </label>
                    <input
                        type="text"
                        readOnly
                        value={settings.activationCode || 'Gerando...'}
                        className="settings-glass-input"
                    />
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" onClick={copyActivationCode} className="glass-toggle active">
                            Copiar código
                        </button>
                        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                            Status: <strong>{licenseLabel}</strong>
                            {settings.planTerm ? ` · Plano: ${settings.planTerm}` : ''}
                            {settings.expiresAt ? ` · Válida até ${new Date(settings.expiresAt).toLocaleString()}` : ''}
                        </span>
                    </div>
                </section>

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
                        <h3>Número do agente (bridge)</h3>
                        <p>Opcional. Se preferir, informe o número em vez do nome do chat (somente dígitos).</p>
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

                <section className="settings-input-card">
                    <label htmlFor="backend-api-url">
                        <h3>URL da API</h3>
                        <p>Endpoint do backend (normalmente não precisa alterar).</p>
                    </label>
                    <input
                        id="backend-api-url"
                        type="url"
                        placeholder="https://tcgsolucoes.app/api"
                        value={settings.backendApiUrl || ''}
                        onChange={(event) => updateBackendSetting('backendApiUrl', event.target.value)}
                        className="settings-glass-input"
                    />
                </section>

                <section className="settings-input-card">
                    <label htmlFor="backend-ws-url">
                        <h3>URL do WebSocket</h3>
                        <p>Endpoint realtime (normalmente não precisa alterar).</p>
                    </label>
                    <input
                        id="backend-ws-url"
                        type="url"
                        placeholder="wss://tcgsolucoes.app/ws"
                        value={settings.backendWsUrl || ''}
                        onChange={(event) => updateBackendSetting('backendWsUrl', event.target.value)}
                        className="settings-glass-input"
                    />
                </section>
            </div>
        </div>
    );
};

export default Settings;
