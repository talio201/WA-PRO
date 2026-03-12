import React, { useEffect, useMemo, useState } from 'react';
import './settings-glass.css';
import { DEFAULT_BACKEND_CONFIG } from '../utils/runtimeConfig';
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
    backendApiKey: '',
    agentId: '',
};
const storageKeys = Object.keys(DEFAULT_SETTINGS);
const Settings = () => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [provisionPayload, setProvisionPayload] = useState('');
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
    const updateBackendSetting = (key, value) => {
        persistSettings({
            ...settings,
            [key]: String(value || ''),
        });
    };
    const importProvisionPayload = () => {
        try {
            const raw = window.prompt('Cole o payload JSON gerado no Admin Console:');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            persistSettings({
                ...settings,
                backendApiUrl: String(parsed.backendApiUrl || settings.backendApiUrl || ''),
                backendWsUrl: String(parsed.backendWsUrl || settings.backendWsUrl || ''),
                backendApiKey: String(parsed.backendApiKey || settings.backendApiKey || ''),
                agentId: String(parsed.agentId || settings.agentId || ''),
            });
        } catch (error) {
            window.alert('Payload inválido.');
        }
    };
    const applyProvisionPayload = () => {
        try {
            const parsed = JSON.parse(String(provisionPayload || '').trim());
            persistSettings({
                ...settings,
                backendApiUrl: String(parsed.backendApiUrl || settings.backendApiUrl || ''),
                backendWsUrl: String(parsed.backendWsUrl || settings.backendWsUrl || ''),
                backendApiKey: String(parsed.backendApiKey || settings.backendApiKey || ''),
                agentId: String(parsed.agentId || settings.agentId || ''),
            });
            setProvisionPayload('');
            window.alert('Payload aplicado com sucesso.');
        } catch (error) {
            window.alert('JSON inválido. Verifique o payload e tente novamente.');
        }
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
                    <button type="button" className="glass-toggle active" onClick={importProvisionPayload} aria-label="Importar payload">
                        ⬇
                    </button>
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
                <section className="settings-input-card">
                    <label htmlFor="provision-payload-json">
                        <h3>Provisionamento JSON (Admin Console)</h3>
                        <p>Cole aqui o JSON gerado no painel admin para preencher automaticamente os campos abaixo.</p>
                    </label>
                    <textarea
                        id="provision-payload-json"
                        placeholder='{"backendApiUrl":"https://.../api","backendWsUrl":"wss://.../ws","backendApiKey":"...","agentId":"bot_xxx"}'
                        value={provisionPayload}
                        onChange={(event) => setProvisionPayload(event.target.value)}
                        className="settings-glass-input"
                        rows={5}
                    />
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <button
                            type="button"
                            onClick={applyProvisionPayload}
                            className="glass-toggle active"
                            aria-label="Aplicar payload"
                        >
                            Aplicar payload
                        </button>
                        <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>Também é possível usar o botão ⬇ no topo.</span>
                    </div>
                </section>
                <section className="settings-input-card">
                    <label htmlFor="agent-id">
                        <h3>ID exclusivo do bot</h3>
                        <p>Identificador provisionado pelo Admin Console.</p>
                    </label>
                    <input
                        id="agent-id"
                        type="text"
                        placeholder="bot_xxxxx"
                        value={settings.agentId || ''}
                        onChange={(event) => updateBackendSetting('agentId', event.target.value)}
                        className="settings-glass-input"
                    />
                </section>
                <section className="settings-input-card">
                    <label htmlFor="backend-api-url">
                        <h3>URL da API</h3>
                        <p>Endpoint completo do backend, ex: https://tcgsolucoes.app/api</p>
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
                        <p>Endpoint realtime, ex: wss://tcgsolucoes.app/ws</p>
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
                <section className="settings-input-card">
                    <label htmlFor="backend-api-key">
                        <h3>Chave da API</h3>
                        <p>Chave de acesso individual do cliente. Não deixe hardcoded no código.</p>
                    </label>
                    <input
                        id="backend-api-key"
                        type="password"
                        placeholder="Cole a chave fornecida pelo administrador"
                        value={settings.backendApiKey || ''}
                        onChange={(event) => updateBackendSetting('backendApiKey', event.target.value)}
                        className="settings-glass-input"
                    />
                </section>
            </div>
        </div>
    );
};
export default Settings;
