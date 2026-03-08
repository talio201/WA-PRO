import { GEMINI_KEY } from './config.js';
import { ApiClient } from './api-client.js';

/**
 * AI Service - Integration with Google Gemini Flash
 * Handles automatic text rewriting into Spintax format.
 */

class AIService {
    constructor() {
        this.apiKey = GEMINI_KEY;
        // Base URL is dynamic now
    }

    hasKey() {
        return this.apiKey && this.apiKey !== 'SUA_KEY_DO_GEMINI_AQUI';
    }

    setModel(modelName) {
        this.selectedModel = modelName;
        console.log(`[AI] Model selected: ${modelName}`);
    }

    async getAvailableModels() {
        if (!this.hasKey()) return [];
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            const data = await response.json();
            if (data.models) {
                // Filter for models that support generateContent and are "gemini"
                return data.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                    .filter(m => m.name.includes('gemini'))
                    .map(m => ({
                        id: m.name.replace('models/', ''),
                        name: m.displayName || m.name
                    }))
                    .sort((a, b) => b.id.localeCompare(a.id)); // Newest first
            }
            return [];
        } catch (e) {
            console.error('[AI] Failed to fetch models:', e);
            return [];
        }
    }

    async rewriteToSpintax(text, signal = null) {
        try {
            // Use ApiClient so Authorization + x-agent-id are always sent.
            const data = await new ApiClient().rewriteMessage(text, this.selectedModel || null);
            if (!data || !Array.isArray(data.versions)) {
                throw new Error('Falha na comunicação com o servidor de IA');
            }
            return data;
        } catch (error) {
            console.error('[AI] Proxy Error:', error);
            throw error;
        }
    }
}

// Global Export
window.aiService = new AIService();
