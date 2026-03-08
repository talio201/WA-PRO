/**
 * Campaign Engine — Motor de ORQUESTRAÇÃO para envio em massa.
 * A extensão NÃO envia mensagens — ela gerencia tempos e despacha
 * comandos de automação DOM para o WhatsApp Web real.
 *
 * Funcionalidades anti-ban:
 * - Delay Gaussiano (distribuição normal, não uniforme)
 * - Escalação progressiva (warmup → cruzeiro)
 * - Jitter no typing (±30% variação)
 * - Pausa longa periódica (simula uso humano real)
 * - Delay NUNCA repete consecutivo
 * - Human Score em tempo real
 *
 * IA Leve:
 * - Spintax engine: {a|b|c} → escolhe variação por contato
 * - Personalização: {name}, {firstname}, {number}
 * - Cada contato recebe combinação ÚNICA
 */

class CampaignEngine {
    constructor() {
        this.queue = [];
        this.message = '';
        this.mediaFiles = [];  // [{name, type, base64, caption}]
        this.isRunning = false;
        this.isPaused = false;
        this.isCancelled = false;
        this.currentIndex = 0;

        // Stats
        this.stats = { sent: 0, failed: 0, total: 0 };

        // Anti-ban config
        this.config = {
            delayMin: 5,      // seconds
            delayMax: 120,     // seconds
            pauseAfter: 10,   // pause after N messages
            pauseMin: 120,    // long pause min (sec)
            pauseMax: 300,    // long pause max (sec)
            typingMin: 2,     // typing sim min (sec)
            typingMax: 6,     // typing sim max (sec)
            maxConsecutiveFailures: 3, // circuit-breaker before cancel
            riskCooldownMin: 90, // adaptive cool down on suspicious streak
            riskCooldownMax: 240
        };

        // Anti-ban state
        this.lastDelay = 0;
        this.delayHistory = [];     // array of all delays used
        this.currentPhase = 'idle'; // idle | warmup | ramping | cruising | paused
        this.consecutiveFailures = 0;

        // Callbacks – UI hooks
        this.onProgress = null;      // (stats, currentContact) => {}
        this.onLog = null;           // (message, type) => {}
        this.onComplete = null;      // (stats) => {}
        this.onStatusChange = null;  // (status) => {}
        this.onDelayTick = null;     // (remaining, total, phase) => {}
        this.onHumanScore = null;    // (score, details) => {}
    }

    /**
     * Configure the engine
     */
    configure(opts) {
        const next = { ...this.config, ...(opts || {}) };

        // Safety clamps keep anti-ban behavior in a realistic/human range.
        next.delayMin = Math.min(300, Math.max(2, parseInt(next.delayMin, 10) || 5));
        next.delayMax = Math.min(600, Math.max(next.delayMin, parseInt(next.delayMax, 10) || 120));
        next.pauseAfter = Math.min(100, Math.max(5, parseInt(next.pauseAfter, 10) || 10));
        next.pauseMin = Math.min(900, Math.max(30, parseInt(next.pauseMin, 10) || 120));
        next.pauseMax = Math.min(1800, Math.max(next.pauseMin, parseInt(next.pauseMax, 10) || 300));
        next.typingMin = Math.min(15, Math.max(1, Number(next.typingMin) || 2));
        next.typingMax = Math.min(25, Math.max(next.typingMin, Number(next.typingMax) || 6));
        next.maxConsecutiveFailures = Math.min(10, Math.max(2, parseInt(next.maxConsecutiveFailures, 10) || 3));
        next.riskCooldownMin = Math.min(900, Math.max(30, parseInt(next.riskCooldownMin, 10) || 90));
        next.riskCooldownMax = Math.min(1800, Math.max(next.riskCooldownMin, parseInt(next.riskCooldownMax, 10) || 240));

        this.config = next;
    }

    /**
     * Set the campaign data
     */
    setCampaign(contacts, message, mediaFiles = []) {
        this.queue = contacts.map(c => ({
            ...c,
            status: 'pending' // pending | sent | failed
        }));
        this.message = message;
        this.mediaFiles = mediaFiles;
        this.stats = { sent: 0, failed: 0, total: contacts.length };
        this.currentIndex = 0;
        this.isCancelled = false;
        this.isPaused = false;
        this.delayHistory = [];
        this.currentPhase = 'idle';
        this.consecutiveFailures = 0;
    }

    // ==================== SPINTAX ENGINE ====================

    /**
     * Process Spintax template: {opt1|opt2|opt3} → picks one randomly.
     * Uses a seed so each contact gets a deterministic-but-unique combo.
     * Nested spintax is supported: {a|{b|c}} works.
     */
    processSpintax(template, seed = null) {
        const rng = seed !== null ? this._seededRandom(seed) : Math.random;

        // Process from innermost braces outward
        let result = template;
        let safety = 20; // prevent infinite loop
        while (result.includes('{') && safety-- > 0) {
            result = result.replace(/\{([^{}]+)\}/g, (_, group) => {
                const options = group.split('|');
                const idx = Math.floor(rng() * options.length);
                return options[idx];
            });
        }
        return result;
    }

    /**
     * Get N preview variations of a spintax template
     */
    getSpintaxPreviews(template, count = 5) {
        const previews = [];
        const seen = new Set();
        for (let i = 0; i < count * 3 && previews.length < count; i++) {
            const variation = this.processSpintax(template, i * 7919 + 31);
            if (!seen.has(variation)) {
                seen.add(variation);
                previews.push(variation);
            }
        }
        return previews;
    }

    /**
     * Seeded PRNG (Mulberry32) — deterministic per contact index
     */
    _seededRandom(seed) {
        let s = seed | 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ==================== MAIN LOOP ====================

    /**
     * Start the campaign
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isCancelled = false;
        this.isPaused = false;
        this.currentPhase = 'warmup';
        this._emitStatus('running');
        this._log('🚀 Campanha iniciada — ' + this.stats.total + ' contatos na fila', 'info');
        this._emitHumanScore();

        while (this.currentIndex < this.queue.length) {
            if (this.isCancelled) {
                this._log('❌ Campanha cancelada pelo usuário', 'error');
                break;
            }

            if (this.isPaused) {
                this._log('⏸ Campanha pausada...', 'info');
                this.currentPhase = 'paused';
                this._emitStatus('paused');
                await this._waitForResume();
                if (this.isCancelled) break;
                this._log('▶ Campanha retomada', 'info');
                this._emitStatus('running');
            }

            const contact = this.queue[this.currentIndex];
            const msgNum = this.currentIndex + 1;

            // Update phase
            this.currentPhase = this._getPhase(msgNum);

            // ====== ABRIR CONVERSA DE FORMA ROBUSTA ======
            const chatId = this._getChatId(contact);
            let chatOpened = false;
            try {
                // 1. Tenta abrir via openChat (contato salvo ou conversa existente)
                await this._dispatchCommand('OPEN_CHAT', {
                    chatId,
                    contactName: contact.name || contact.pushname || contact.formattedName || '',
                    allowMismatch: true
                });
                chatOpened = true;
            } catch (e) {
                // 2. Se falhar, tenta via openDirectLink (novo contato)
                try {
                    await this._dispatchCommand('openDirectLink', {
                        chatId,
                        allowMismatch: true
                    });
                    chatOpened = true;
                } catch (e2) {
                    this._log(`❌ Falha ao abrir conversa para ${contact.name || contact.number}: ${e2.message || e2}`, 'error');
                    throw e2;
                }
            }

            // 3. Aguarda composer aparecer (garante que a conversa está pronta)
            await this._sleep(600 + Math.random() * 600); // delay extra humano
            try {
                await this._dispatchCommand('SIMULATE_TYPING', {
                    chatId,
                    contactName: contact.name || contact.pushname || contact.formattedName || ''
                });
            } catch (e) { /* não crítico */ }

            // 4. Simula digitação humana
            const baseTyping = this._randomBetween(this.config.typingMin, this.config.typingMax);
            const jitter = baseTyping * (0.7 + Math.random() * 0.6); // ±30%
            const typingDur = Math.round(jitter * 10) / 10;
            this._log(`⌨️ [${msgNum}/${this.stats.total}] Digitando para "${contact.name || contact.number}"... (${typingDur}s)`, 'typing');
            await this._sleep(typingDur * 1000);

            // ====== ENVIO DE MENSAGEM ======
            try {
                // Processa Spintax com seed única por contato
                const spintaxed = this.processSpintax(this.message, this.currentIndex * 1337 + 42);
                const personalizedMsg = this._personalizeMessage(spintaxed, contact);

                let chatAlreadyOpen = true; // já garantido acima


                if (personalizedMsg.trim()) {
                    // Novo fluxo: usa backup (agent-id) para enviar
                    const agentId = '51995056137'; // Substitua pelo agent-id dinâmico se necessário
                    await this._dispatchCommand('SEND_VIA_BACKUP_FLOW', {
                        backupNameOrId: agentId,
                        targetNumber: contact.number,
                        message: personalizedMsg
                    });
                    // LOG PERSISTÊNCIA (TEXTO)
                    this._logToSupabase(contact, 'sent', 'text', personalizedMsg);
                }

                for (const media of this.mediaFiles) {
                    await this._dispatchCommand('SEND_MEDIA', {
                        chatId,
                        base64: media.base64,
                        filename: media.name,
                        caption: media.caption || '',
                        mimetype: media.type,
                        contactName: contact.name || contact.pushname || contact.formattedName || '',
                        skipOpenChat: chatAlreadyOpen
                    });

                    // LOG PERSISTÊNCIA (MÍDIA)
                    const msgType = media.type.startsWith('video') ? 'video' :
                        media.type.startsWith('audio') ? 'audio' :
                            media.type.startsWith('application') ? 'document' : 'image';

                    this._logToSupabase(contact, 'sent', 'media', media.caption || 'Media file', {
                        filename: media.name,
                        caption: media.caption,
                        messageType: msgType
                    });
                }

                contact.status = 'sent';
                this.stats.sent++;
                this.consecutiveFailures = 0;
                this._log(`✅ [${msgNum}/${this.stats.total}] Enviado → "${contact.name || contact.number}"`, 'success');
            } catch (error) {
                const msg = String(error && error.message ? error.message : error);
                const isMismatch = msg.includes('CHAT_MISMATCH');

                contact.status = isMismatch ? 'review' : 'failed';
                this.stats.failed++;
                if (!isMismatch) this.consecutiveFailures++;

                if (isMismatch) {
                    this._log(`⚠️ [${msgNum}/${this.stats.total}] Revisão manual necessária → "${contact.name || contact.number}" — ${msg}`, 'error');
                    this._log('⚠️ A campanha continuará; finalize depois em Atendimentos > Pendências.', 'info');
                } else {
                    this._log(`❌ [${msgNum}/${this.stats.total}] Falhou → "${contact.name || contact.number}" — ${msg}`, 'error');
                }

                // LOG PERSISTENCE (FAILURE)
                this._logToSupabase(contact, 'failed', 'unknown', msg);

                if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
                    const cooldownSec = this._gaussianRandom(this.config.riskCooldownMin, this.config.riskCooldownMax);
                    this._log(
                        `🛑 Risco detectado: ${this.consecutiveFailures} falhas seguidas. Aplicando cooldown de ${cooldownSec}s.`,
                        'error'
                    );
                    this.currentPhase = 'paused';
                    await this._sleepWithCountdown(cooldownSec * 1000, 'pause');

                    // Circuit breaker: if still failing repeatedly after cooldown, abort campaign.
                    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures + 1) {
                        this._log('🛑 Campanha interrompida por proteção anti-ban (falhas consecutivas).', 'error');
                        this.isCancelled = true;
                    }
                }
            }

            this._emitProgress(contact);
            this.currentIndex++;

            // ====== DELAY BETWEEN MESSAGES ======
            if (this.currentIndex < this.queue.length) {
                // Long pause every N messages
                if (this.currentIndex > 0 && this.currentIndex % this.config.pauseAfter === 0) {
                    const longPause = this._gaussianRandom(this.config.pauseMin, this.config.pauseMax);
                    this._log(`☕ Pausa longa: ${longPause}s (após ${this.config.pauseAfter} msgs) — Simulando uso normal`, 'info');
                    this.currentPhase = 'paused';

                    try {
                        await this._dispatchCommand('SIMULATE_PRESENCE', {});
                    } catch (e) { /* non-critical */ }

                    await this._sleepWithCountdown(longPause * 1000, 'pause');
                } else {
                    // Gaussian delay with escalation (never repeats)
                    const delay = this._calculateDelay(msgNum);
                    this.delayHistory.push(delay);
                    this._log(`⏱ Aguardando ${delay}s antes da próxima... [${this.currentPhase}]`, 'info');
                    await this._sleepWithCountdown(delay * 1000, this.currentPhase);
                }

                this._emitHumanScore();
            }
        }

        this.isRunning = false;
        this.currentPhase = 'idle';
        this._emitStatus('completed');
        this._log(`🏁 Campanha finalizada! Enviados: ${this.stats.sent}, Falhas: ${this.stats.failed}`, 'info');
        if (this.onComplete) this.onComplete(this.stats);
    }

    pause() { this.isPaused = true; }
    resume() { this.isPaused = false; }
    cancel() {
        this.isCancelled = true;
        this.isPaused = false;
        this.isRunning = false;
    }

    // ==================== ANTI-BAN DELAY SYSTEM ====================

    /**
     * Determine current phase based on message number
     */
    _getPhase(msgNum) {
        if (msgNum <= 2) return 'warmup';
        if (msgNum <= 5) return 'ramping';
        return 'cruising';
    }

    /**
     * Get the delay ranges for each phase (used by UI for visualization)
     */
    getDelayRanges() {
        const c = this.config;
        return [
            { phase: 'warmup', label: 'Aquecimento', msgs: '1–2', min: Math.max(c.delayMin, 3), max: Math.min(30, c.delayMax), color: '#22c55e' },
            { phase: 'ramping', label: 'Rampa', msgs: '3–5', min: Math.max(10, c.delayMin), max: Math.min(60, c.delayMax), color: '#f59e0b' },
            { phase: 'cruising', label: 'Cruzeiro', msgs: '6+', min: Math.max(20, c.delayMin), max: c.delayMax, color: '#2563eb' },
            { phase: 'pause', label: 'Pausa Longa', msgs: `a cada ${c.pauseAfter}`, min: c.pauseMin, max: c.pauseMax, color: '#8b5cf6' },
        ];
    }

    /**
     * Calculate delay with Gaussian distribution and escalation.
     * gaussian == bell curve: values cluster near the center, feel more human.
     * NEVER repeats the same delay consecutively.
     */
    _calculateDelay(msgNumber) {
        let min, max;

        if (msgNumber <= 2) {
            // Warmup: short delays
            min = Math.max(this.config.delayMin, 3);
            max = Math.min(30, this.config.delayMax);
        } else if (msgNumber <= 5) {
            // Ramping: medium delays
            min = Math.max(10, this.config.delayMin);
            max = Math.min(60, this.config.delayMax);
        } else {
            // Cruising: full range
            min = Math.max(20, this.config.delayMin);
            max = this.config.delayMax;
        }

        if (min > max) min = max;

        let delay;
        let attempts = 0;
        do {
            delay = this._gaussianRandom(min, max);
            attempts++;
        } while (delay === this.lastDelay && attempts < 15);

        this.lastDelay = delay;
        return delay;
    }

    /**
     * Gaussian (normal distribution) random between min and max.
     * Uses Box-Muller transform. Values cluster around the center.
     */
    _gaussianRandom(min, max) {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();

        // Box-Muller transform → standard normal
        let n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);

        // Scale to [0, 1] (clamp ±3σ)
        n = Math.max(-3, Math.min(3, n));
        const normalized = (n + 3) / 6; // maps [-3,3] → [0,1]

        return Math.round(min + normalized * (max - min));
    }

    /**
     * Calculate Human Score (0–100).
     * Higher = more human-like behavior.
     */
    calculateHumanScore() {
        const details = {};
        let score = 100;

        // 1. Delay variance (monotone delays = bot-like)
        if (this.delayHistory.length >= 3) {
            const unique = new Set(this.delayHistory).size;
            const ratio = unique / this.delayHistory.length;
            details.delayVariance = Math.round(ratio * 100);
            if (ratio < 0.5) score -= 20;
            else if (ratio < 0.7) score -= 10;
        } else {
            details.delayVariance = 100;
        }

        // 2. Average delay (too fast = suspicious)
        if (this.delayHistory.length > 0) {
            const avg = this.delayHistory.reduce((a, b) => a + b, 0) / this.delayHistory.length;
            details.avgDelay = Math.round(avg);
            if (avg < 5) score -= 30;
            else if (avg < 15) score -= 15;
            else if (avg < 30) score -= 5;
        } else {
            details.avgDelay = 0;
        }

        // 3. Speed (msgs per minute)
        const elapsed = this.delayHistory.reduce((a, b) => a + b, 0) || 1;
        const msgsPerMin = (this.stats.sent / (elapsed / 60));
        details.msgsPerMin = Math.round(msgsPerMin * 10) / 10;
        if (msgsPerMin > 4) score -= 25;
        else if (msgsPerMin > 2) score -= 10;

        // 4. Spintax variety bonus
        if (this.message.includes('{') && this.message.includes('|')) {
            score = Math.min(100, score + 10);
            details.spintaxActive = true;
        } else {
            details.spintaxActive = false;
        }

        // 5. Delay config range
        const range = this.config.delayMax - this.config.delayMin;
        if (range > 60) score = Math.min(100, score + 5);
        else if (range < 10) score -= 15;
        details.delayRange = range;

        details.score = Math.max(0, Math.min(100, score));
        return details;
    }

    // ==================== HELPERS ====================

    _getChatId(contact) {
        if (typeof contact.id === 'string') return contact.id;
        if (contact.id && contact.id._serialized) return contact.id._serialized;
        return (contact.number || '') + '@c.us';
    }

    _personalizeMessage(template, contact) {
        const name = contact.name || contact.pushname || contact.formattedName || '';
        const firstName = name.split(' ')[0] || '';
        return template
            .replace(/\{name\}/gi, name)
            .replace(/\{firstname\}/gi, firstName)
            .replace(/\{number\}/gi, contact.number || '');
    }

    _dispatchCommand(type, data) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type, data },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (response && response.error) {
                        reject(new Error(response.error));
                        return;
                    }
                    resolve(response);
                }
            );
        });
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Sleep with countdown ticks — emits onDelayTick every second
     */
    async _sleepWithCountdown(ms, phase) {
        const totalSec = Math.ceil(ms / 1000);
        let remaining = totalSec;

        while (remaining > 0) {
            if (this.isCancelled) return;
            if (this.isPaused) {
                await this._waitForResume();
                if (this.isCancelled) return;
            }

            if (this.onDelayTick) {
                this.onDelayTick(remaining, totalSec, phase);
            }

            await this._sleep(1000);
            remaining--;
        }

        // Final tick at 0
        if (this.onDelayTick) this.onDelayTick(0, totalSec, phase);
    }

    /**
     * Legacy: sleep with pause check (backwards compat)
     */
    async _sleepWithPauseCheck(ms) {
        await this._sleepWithCountdown(ms, this.currentPhase);
    }

    _waitForResume() {
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!this.isPaused || this.isCancelled) {
                    clearInterval(check);
                    resolve();
                }
            }, 500);
        });
    }

    _randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _emitProgress(contact) {
        if (this.onProgress) this.onProgress({ ...this.stats }, contact);
    }

    _emitHumanScore() {
        if (this.onHumanScore) {
            this.onHumanScore(this.calculateHumanScore());
        }
    }

    _log(message, type = 'info') {
        console.log(`[CampaignEngine] ${message}`);
        if (this.onLog) this.onLog(message, type);
    }

    _emitStatus(status) {
        if (this.onStatusChange) this.onStatusChange(status);
    }
    async _logToSupabase(contact, status, type, contentOrError, extraData = {}) {
        if (!window.ApiClient) return;

        try {
            const client = new window.ApiClient();
            const contactId = typeof contact.id === 'object' ? contact.id._serialized : contact.id;

            await client.logMessage({
                contactId: contactId,
                contactName: contact.name || contact.pushname || 'Unknown',
                messageText: type === 'text' ? contentOrError : (extraData.caption || ''),
                hasMedia: type === 'media',
                mediaFilename: extraData.filename || '',
                messageType: extraData.messageType || (type === 'media' ? 'image' : 'text'),
                mediaUrl: extraData.mediaUrl || null,
                status: status,
                errorMessage: status === 'failed' ? contentOrError : '',
                campaignId: this.id || 'manual_campaign',
                direction: 'outbound'
            });
        } catch (e) {
            console.error('[CampaignEngine] Failed to log to Supabase:', e);
        }
    }
}

// Make globally available
window.CampaignEngine = CampaignEngine;
