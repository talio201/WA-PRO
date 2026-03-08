const Campaign = require('../models/Campaign');
const Message = require('../models/Message');
const { normalizePhone } = require('../utils/phone');
const { buildServerErrorResponse } = require('../utils/httpError');
const { emitRealtimeEvent } = require('../realtime/realtime');

const DEFAULT_MIN_DELAY_SECONDS = 0;
const DEFAULT_MAX_DELAY_SECONDS = 120;
const MAX_ALLOWED_DELAY_SECONDS = 3600;

function sanitizeAntiBanSettings(input = {}) {
    let minDelaySeconds = Number(input.minDelaySeconds);
    let maxDelaySeconds = Number(input.maxDelaySeconds);

    if (!Number.isFinite(minDelaySeconds)) minDelaySeconds = DEFAULT_MIN_DELAY_SECONDS;
    if (!Number.isFinite(maxDelaySeconds)) maxDelaySeconds = DEFAULT_MAX_DELAY_SECONDS;

    minDelaySeconds = Math.max(0, Math.min(minDelaySeconds, MAX_ALLOWED_DELAY_SECONDS));
    maxDelaySeconds = Math.max(0, Math.min(maxDelaySeconds, MAX_ALLOWED_DELAY_SECONDS));

    if (maxDelaySeconds < minDelaySeconds) {
        [minDelaySeconds, maxDelaySeconds] = [maxDelaySeconds, minDelaySeconds];
    }

    return { minDelaySeconds, maxDelaySeconds };
}

function sanitizeMessageVariants(input, baseMessageTemplate) {
    const list = Array.isArray(input) ? input : [];
    const unique = [];
    const seen = new Set();

    list.forEach((value) => {
        const text = String(value || '').trim();
        if (!text) return;
        if (seen.has(text)) return;
        seen.add(text);
        unique.push(text);
    });

    const baseText = String(baseMessageTemplate || '').trim();
    if (baseText && !seen.has(baseText)) {
        unique.unshift(baseText);
    }

    return unique;
}

// @desc    Create a new campaign
// @route   POST /api/campaigns
// @access  Public (Localhost)
exports.createCampaign = async (req, res) => {
    try {
        const {
            name,
            messageTemplate,
            messageVariants = [],
            turboMode = false,
            contacts = [],
            media = null,
            antiBan = {}
        } = req.body; // contacts array of { phone, name, variables }

        const antiBanSettings = sanitizeAntiBanSettings(antiBan);
        const sanitizedVariants = sanitizeMessageVariants(messageVariants, messageTemplate);
        const shouldRotateVariants = Boolean(turboMode) && sanitizedVariants.length > 1 && contacts.length > 1;

        const campaign = new Campaign({
            name,
            messageTemplate,
            messageVariants: sanitizedVariants,
            turboMode: shouldRotateVariants,
            status: 'running', // Fix: Auto-start campaign
            antiBan: antiBanSettings,
            stats: {
                total: contacts.length,
                sent: 0,
                failed: 0
            },
            media
        });

        await campaign.save();

        // Create Message Jobs
        const messages = contacts.map((contact, index) => {
            const phoneNormalization = normalizePhone(contact.phone);
            const normalizedPhone = phoneNormalization.normalized || String(contact.phone || '').replace(/\D/g, '');
            const template = shouldRotateVariants
                ? sanitizedVariants[index % sanitizedVariants.length]
                : (messageTemplate || sanitizedVariants[0] || '');

            return {
                campaign: campaign._id,
                phone: normalizedPhone,
                phoneOriginal: String(contact.phone || ''),
                searchTerms: phoneNormalization.searchTerms,
                name: contact.name,
                variables: contact.variables,
                processedMessage: String(template || '').replace(/{name}/g, contact.name || ''), // Simple replacement
                status: 'pending',
                attemptCount: 0,
                lastError: null,
                audit: [
                    {
                        at: new Date(),
                        action: 'queued',
                        details: 'Message added to queue',
                    },
                ],
                updatedAt: new Date(),
            };
        });

        if (messages.length > 0) {
            await Message.insertMany(messages);
        }

        emitRealtimeEvent('campaign.created', {
            campaign: {
                _id: campaign._id,
                name: campaign.name,
                status: campaign.status,
                stats: campaign.stats,
                createdAt: campaign.createdAt,
            },
            queuedMessages: messages.length,
        });

        emitRealtimeEvent('campaign.messages.queued', {
            campaignId: campaign._id,
            count: messages.length,
        });

        res.status(201).json(campaign);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Get all campaigns
// @route   GET /api/campaigns
exports.getCampaigns = async (req, res) => {
    try {
        const campaigns = await Campaign.find().sort({ createdAt: -1 });
        res.json(campaigns);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Get failed messages for a campaign
// @route   GET /api/campaigns/:id/failures
exports.getCampaignFailures = async (req, res) => {
    try {
        const campaigns = await Campaign.find({ _id: req.params.id });
        const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;

        if (!campaign) {
            return res.status(404).json({ msg: 'Campaign not found' });
        }

        const failures = await Message.find({ campaign: req.params.id, status: 'failed' });
        const orderedFailures = [...failures].sort((a, b) => {
            const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return bDate - aDate;
        });

        res.json({
            campaign: {
                _id: campaign._id,
                name: campaign.name,
                status: campaign.status,
                stats: campaign.stats,
            },
            failures: orderedFailures,
        });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
exports.deleteCampaign = async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id);

        if (!campaign) {
            return res.status(404).json({ msg: 'Campaign not found' });
        }

        await Message.deleteMany({ campaign: req.params.id });
        await Campaign.deleteById(req.params.id);

        emitRealtimeEvent('campaign.deleted', {
            campaignId: req.params.id,
            name: campaign.name || '',
        });

        res.json({ msg: 'Campaign removed' });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};
