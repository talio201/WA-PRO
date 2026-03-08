const Message = require('../models/Message');
const Campaign = require('../models/Campaign');
const ConversationAssignment = require('../models/ConversationAssignment');
const { normalizePhone } = require('../utils/phone');
const { buildServerErrorResponse } = require('../utils/httpError');
const { emitRealtimeEvent } = require('../realtime/realtime');
const { logSendResult } = require('../monitorSendFlow');

function appendAudit(message, action, details, meta = {}) {
    if (!Array.isArray(message.audit)) {
        message.audit = [];
    }

    message.audit.push({
        at: new Date(),
        action,
        details,
        meta,
    });
}

function ensureCampaignStats(campaign) {
    if (!campaign.stats) {
        campaign.stats = { total: 0, sent: 0, failed: 0 };
    }
}

function applyCampaignStatTransition(campaign, previousStatus, nextStatus) {
    if (!campaign) return;

    ensureCampaignStats(campaign);

    const map = {
        sent: 'sent',
        failed: 'failed',
    };

    const previousField = map[previousStatus];
    const nextField = map[nextStatus];

    if (previousField && previousField !== nextField && campaign.stats[previousField] > 0) {
        campaign.stats[previousField] -= 1;
    }

    if (nextField && previousField !== nextField) {
        campaign.stats[nextField] = (campaign.stats[nextField] || 0) + 1;
    }
}

function applyMessageEdits(message, payload = {}) {
    const changedFields = [];

    if (payload.phone !== undefined) {
        const normalized = normalizePhone(payload.phone);
        const nextPhone = normalized.normalized || String(payload.phone || '').replace(/\D/g, '');

        if (nextPhone && nextPhone !== message.phone) {
            message.phone = nextPhone;
            changedFields.push('phone');
        }

        message.phoneOriginal = String(payload.phone || '');
        message.searchTerms = normalized.searchTerms;
    }

    if (payload.name !== undefined && payload.name !== message.name) {
        message.name = payload.name;
        changedFields.push('name');
    }

    if (payload.processedMessage !== undefined && payload.processedMessage !== message.processedMessage) {
        message.processedMessage = payload.processedMessage;
        changedFields.push('processedMessage');
    }

    return changedFields;
}

function getMessageDateMs(message) {
    return new Date(message.updatedAt || message.sentAt || message.createdAt || 0).getTime();
}

function toSafePhone(value) {
    return normalizePhone(value).normalized || String(value || '').replace(/\D/g, '');
}

function parseBooleanFlag(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function extractCampaignIdFromPayload(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return value._id || value.id || null;
}

function isConversationAssignmentsTableMissing(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('could not find the table')
        && message.includes('conversation_assignments');
}

function pickLatestAssignment(assignments = []) {
    const list = Array.isArray(assignments) ? assignments : [];
    if (list.length === 0) return null;

    return [...list].sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.assignedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.assignedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    })[0];
}

function resolveAgentIdFromRequest(req) {
    const fromBody = String(req.body?.agentId || '').trim();
    const fromQuery = String(req.query?.agentId || '').trim();
    const fromHeader = String(req.headers?.['x-agent-id'] || '').trim();
    return fromBody || fromQuery || fromHeader;
}

function normalizeHistoryDirection(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'inbound' ? 'inbound' : 'outbound';
}

function normalizeHistoryTimestamp(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function extractMessageFingerprint(message) {
    const auditList = Array.isArray(message?.audit) ? message.audit : [];
    const entry = auditList.find((item) => {
        const fingerprint = String(item?.meta?.fingerprint || '').trim();
        return Boolean(fingerprint);
    });

    return String(entry?.meta?.fingerprint || '').trim();
}

function buildHistoryTextPayload(item = {}) {
    const text = String(item.text || item.processedMessage || '').trim();
    const mediaUrl = String(item.mediaUrl || '').trim();
    const linkUrl = String(item.linkUrl || '').trim();

    if (text) return text;
    if (mediaUrl) return mediaUrl;
    if (linkUrl) return linkUrl;

    return '';
}

function isHistoryDuplicate(existingMessage, candidate = {}) {
    if (!existingMessage || !candidate) return false;

    const existingDirection = normalizeHistoryDirection(existingMessage.direction);
    const candidateDirection = normalizeHistoryDirection(candidate.direction);
    if (existingDirection !== candidateDirection) return false;

    const existingFingerprint = extractMessageFingerprint(existingMessage);
    const candidateFingerprint = String(candidate.fingerprint || '').trim();
    if (existingFingerprint && candidateFingerprint) {
        return existingFingerprint === candidateFingerprint;
    }

    const existingText = String(existingMessage.processedMessage || '').trim();
    const candidateText = String(candidate.text || '').trim();
    if (!existingText || !candidateText) return false;
    if (existingText !== candidateText) return false;

    const existingAt = getMessageDateMs(existingMessage);
    const candidateAt = new Date(candidate.at || 0).getTime();
    if (!Number.isFinite(existingAt) || !Number.isFinite(candidateAt)) return false;

    return Math.abs(existingAt - candidateAt) <= 90 * 1000;
}

async function ensureConversationOwnership({ normalizedPhone, agentId }) {
    if (!agentId) {
        const error = new Error('agentId is required.');
        error.statusCode = 400;
        error.code = 'AGENT_ID_REQUIRED';
        throw error;
    }

    const assignments = await ConversationAssignment.find({
        phone: normalizedPhone,
        status: 'active',
    });
    const activeAssignment = pickLatestAssignment(assignments);

    if (!activeAssignment) {
        const error = new Error('Conversa nao possui atendimento ativo.');
        error.statusCode = 403;
        error.code = 'CONVERSATION_NOT_ASSIGNED';
        throw error;
    }

    const owner = String(activeAssignment.assignedTo || '').trim();
    if (!owner || owner !== agentId) {
        const error = new Error(`Atendimento pertence a ${owner || 'outro agente'}.`);
        error.statusCode = 403;
        error.code = 'CONVERSATION_ASSIGNED_TO_OTHER_AGENT';
        throw error;
    }

    return activeAssignment;
}

async function resolveRelatedCampaignId({
    normalizedPhone,
    preferredCampaignId = null,
    relatedMessages = [],
}) {
    if (preferredCampaignId) return preferredCampaignId;

    const history = Array.isArray(relatedMessages) ? relatedMessages : [];
    const fromHistory = [...history]
        .sort((a, b) => getMessageDateMs(b) - getMessageDateMs(a))
        .find((item) => String(item.direction || 'outbound') !== 'inbound' && item.campaign)?.campaign || null;

    if (fromHistory) return fromHistory;
    if (!normalizedPhone || normalizedPhone.length < 8) return null;

    const allMessages = await Message.find({});
    const allList = Array.isArray(allMessages) ? allMessages : [];
    const targetTail = normalizedPhone.slice(-10);

    const fuzzyMatch = allList
        .filter((item) => String(item.direction || 'outbound') !== 'inbound' && item.campaign)
        .sort((a, b) => getMessageDateMs(b) - getMessageDateMs(a))
        .find((item) => {
            const messagePhone = toSafePhone(item.phone || item.phoneOriginal);
            if (!messagePhone) return false;

            if (messagePhone === normalizedPhone) return true;
            if (messagePhone.endsWith(targetTail)) return true;
            if (normalizedPhone.endsWith(messagePhone.slice(-10))) return true;
            return false;
        });

    return fuzzyMatch?.campaign || null;
}

// @desc    List message logs for dashboard/inbox
// @route   GET /api/messages
exports.getMessages = async (req, res) => {
    try {
        const {
            status,
            direction,
            phone,
            campaignId,
            limit,
        } = req.query;

        const maxLimit = 1000;
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit)
            ? Math.max(1, Math.min(parsedLimit, maxLimit))
            : 200;

        const allMessages = await Message.find({});
        let filtered = Array.isArray(allMessages) ? allMessages : [];

        if (status) {
            filtered = filtered.filter((item) => item.status === status);
        }

        if (direction) {
            filtered = filtered.filter((item) => String(item.direction || 'outbound') === String(direction));
        }

        if (campaignId) {
            filtered = filtered.filter((item) => item.campaign === campaignId);
        }

        if (phone) {
            const normalized = normalizePhone(phone).normalized;
            const phoneDigits = String(phone).replace(/\D/g, '');
            filtered = filtered.filter((item) => {
                const messagePhone = String(item.phone || '').replace(/\D/g, '');
                return messagePhone === normalized || messagePhone === phoneDigits;
            });
        }

        filtered.sort((a, b) => {
            const aTime = new Date(a.updatedAt || a.sentAt || a.createdAt || 0).getTime();
            const bTime = new Date(b.updatedAt || b.sentAt || b.createdAt || 0).getTime();
            return bTime - aTime;
        });

        res.json(filtered.slice(0, safeLimit));
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    List conversations grouped by phone with assignment metadata
// @route   GET /api/messages/conversations
exports.getConversations = async (req, res) => {
    try {
        const {
            search = '',
            onlyWithReplies,
            onlyAssigned,
            limit,
        } = req.query;

        const allMessages = await Message.find({});

        let activeAssignments = [];
        try {
            activeAssignments = await ConversationAssignment.find({ status: 'active' });
        } catch (assignmentError) {
            if (!isConversationAssignmentsTableMissing(assignmentError)) {
                throw assignmentError;
            }

            activeAssignments = [];
        }

        const assignmentByPhone = new Map();
        (Array.isArray(activeAssignments) ? activeAssignments : []).forEach((assignment) => {
            const phone = toSafePhone(assignment.phone);
            if (!phone) return;

            const existing = assignmentByPhone.get(phone);
            const nextDate = new Date(assignment.updatedAt || assignment.assignedAt || 0).getTime();
            const currentDate = existing ? new Date(existing.updatedAt || existing.assignedAt || 0).getTime() : 0;

            if (!existing || nextDate >= currentDate) {
                assignmentByPhone.set(phone, assignment);
            }
        });

        const conversationMap = new Map();
        (Array.isArray(allMessages) ? allMessages : []).forEach((message) => {
            const phone = toSafePhone(message.phone || message.phoneOriginal);
            if (!phone) return;

            const messageDate = getMessageDateMs(message);
            const direction = String(message.direction || 'outbound');
            const item = conversationMap.get(phone) || {
                phone,
                name: message.name || message.phoneOriginal || phone,
                campaignId: message.campaign || null,
                outboundCount: 0,
                inboundCount: 0,
                failedCount: 0,
                lastAt: message.updatedAt || message.sentAt || message.createdAt || null,
                lastMessage: message.processedMessage || '',
                lastDirection: direction,
                lastStatus: message.status || 'pending',
            };

            if (direction === 'inbound') {
                item.inboundCount += 1;
            } else {
                item.outboundCount += 1;
            }

            if (message.status === 'failed') {
                item.failedCount += 1;
            }

            if (!item.campaignId && message.campaign) {
                item.campaignId = message.campaign;
            }

            const currentLastDate = new Date(item.lastAt || 0).getTime();
            if (messageDate >= currentLastDate) {
                item.lastAt = message.updatedAt || message.sentAt || message.createdAt || item.lastAt;
                item.lastMessage = message.processedMessage || item.lastMessage;
                item.lastDirection = direction;
                item.lastStatus = message.status || item.lastStatus;
                if (message.name) item.name = message.name;
                if (message.campaign) item.campaignId = message.campaign;
            }

            conversationMap.set(phone, item);
        });

        const onlyReplies = parseBooleanFlag(onlyWithReplies);
        const assignedOnly = parseBooleanFlag(onlyAssigned);
        const query = String(search || '').trim().toLowerCase();
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit)
            ? Math.max(1, Math.min(parsedLimit, 1000))
            : 300;

        const list = Array.from(conversationMap.values())
            .map((conversation) => {
                const assignment = assignmentByPhone.get(conversation.phone) || null;
                return {
                    ...conversation,
                    hasResponse: conversation.inboundCount > 0,
                    assignment: assignment ? {
                        _id: assignment._id,
                        assignedTo: assignment.assignedTo,
                        assignedBy: assignment.assignedBy,
                        assignedAt: assignment.assignedAt,
                        status: assignment.status,
                        campaignId: assignment.campaignId || conversation.campaignId || null,
                        updatedAt: assignment.updatedAt,
                    } : null,
                };
            })
            .filter((conversation) => {
                if (onlyReplies && !conversation.hasResponse) return false;
                if (assignedOnly && !conversation.assignment) return false;

                if (!query) return true;
                return (
                    String(conversation.phone || '').toLowerCase().includes(query)
                    || String(conversation.name || '').toLowerCase().includes(query)
                    || String(conversation.assignment?.assignedTo || '').toLowerCase().includes(query)
                );
            })
            .sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime())
            .slice(0, safeLimit);

        res.json(list);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Get full conversation history (locked by agent ownership)
// @route   GET /api/messages/conversations/:phone/history
exports.getConversationHistory = async (req, res) => {
    try {
        const normalizedPhone = toSafePhone(req.params.phone);
        const agentId = resolveAgentIdFromRequest(req);

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'Phone is required.' });
        }

        await ensureConversationOwnership({
            normalizedPhone,
            agentId,
        });

        const parsedLimit = Number(req.query?.limit);
        const safeLimit = Number.isFinite(parsedLimit)
            ? Math.max(1, Math.min(parsedLimit, 5000))
            : 2000;

        const history = await Message.find({ phone: normalizedPhone });
        const ordered = (Array.isArray(history) ? history : [])
            .sort((a, b) => getMessageDateMs(a) - getMessageDateMs(b));

        const sliced = ordered.length > safeLimit
            ? ordered.slice(ordered.length - safeLimit)
            : ordered;

        res.json(sliced);
    } catch (err) {
        if (err?.statusCode) {
            return res.status(err.statusCode).json({
                msg: err.message,
                code: err.code || 'CONVERSATION_HISTORY_FORBIDDEN',
            });
        }

        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Sync WhatsApp chat history into storage (locked by agent ownership)
// @route   POST /api/messages/conversations/:phone/history/sync
exports.syncConversationHistory = async (req, res) => {
    try {
        const normalizedPhone = toSafePhone(req.params.phone || req.body?.phone);
        const agentId = resolveAgentIdFromRequest(req);
        const source = String(req.body?.source || 'whatsapp_history_sync').trim();

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'Phone is required.' });
        }

        const assignment = await ensureConversationOwnership({
            normalizedPhone,
            agentId,
        });

        const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        if (incomingMessages.length === 0) {
            return res.json({
                phone: normalizedPhone,
                inserted: 0,
                duplicates: 0,
                skipped: 0,
                totalReceived: 0,
            });
        }

        const existingMessages = await Message.find({ phone: normalizedPhone });
        const existingList = Array.isArray(existingMessages) ? existingMessages : [];

        const resolvedCampaignId = await resolveRelatedCampaignId({
            normalizedPhone,
            preferredCampaignId: req.body?.campaignId || assignment?.campaignId || null,
            relatedMessages: existingList,
        });

        const normalizedSearchTerms = normalizePhone(normalizedPhone).searchTerms;
        const workingHistory = [...existingList];
        const payloads = [];

        let duplicates = 0;
        let skipped = 0;
        let lastInboundAt = assignment?.lastInboundAt ? new Date(assignment.lastInboundAt) : null;

        incomingMessages.forEach((rawItem) => {
            const direction = normalizeHistoryDirection(rawItem?.direction);
            const atDate = normalizeHistoryTimestamp(rawItem?.at) || new Date();
            const textPayload = buildHistoryTextPayload(rawItem);
            const fingerprint = String(rawItem?.fingerprint || '').trim();
            const contactName = String(rawItem?.name || req.body?.name || '').trim();

            if (!textPayload) {
                skipped += 1;
                return;
            }

            const candidate = {
                direction,
                at: atDate.toISOString(),
                text: textPayload,
                fingerprint,
            };

            const duplicate = workingHistory.find((item) => isHistoryDuplicate(item, candidate));
            if (duplicate) {
                duplicates += 1;
                return;
            }

            const payload = {
                campaign: resolvedCampaignId || null,
                phone: normalizedPhone,
                phoneOriginal: normalizedPhone,
                searchTerms: normalizedSearchTerms,
                name: contactName,
                variables: null,
                processedMessage: textPayload,
                status: 'sent',
                direction,
                attemptCount: 1,
                error: null,
                lastError: null,
                sentAt: atDate,
                updatedAt: atDate,
                audit: [
                    {
                        at: new Date(),
                        action: 'history_sync',
                        details: 'Message imported from WhatsApp chat history',
                        meta: {
                            source,
                            syncedBy: agentId,
                            fingerprint,
                        },
                    },
                ],
            };

            payloads.push(payload);
            workingHistory.push(payload);

            if (direction === 'inbound' && (!lastInboundAt || atDate.getTime() > lastInboundAt.getTime())) {
                lastInboundAt = atDate;
            }
        });

        if (payloads.length > 0) {
            await Message.insertMany(payloads);
            emitRealtimeEvent('messages.history.synced', {
                phone: normalizedPhone,
                campaignId: resolvedCampaignId || null,
                inserted: payloads.length,
                syncedBy: agentId,
            });
        }

        if (lastInboundAt) {
            const refreshedAssignment = new ConversationAssignment({
                ...assignment,
                lastInboundAt,
                updatedAt: new Date(),
            });
            await refreshedAssignment.save();
        }

        return res.json({
            phone: normalizedPhone,
            campaignId: resolvedCampaignId || null,
            inserted: payloads.length,
            duplicates,
            skipped,
            totalReceived: incomingMessages.length,
        });
    } catch (err) {
        if (err?.statusCode) {
            return res.status(err.statusCode).json({
                msg: err.message,
                code: err.code || 'CONVERSATION_HISTORY_SYNC_FORBIDDEN',
            });
        }

        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Assign conversation ownership for atendimento
// @route   PUT /api/messages/conversations/:phone/assign
exports.assignConversation = async (req, res) => {
    try {
        const normalizedPhone = toSafePhone(req.params.phone);
        const agentName = String(req.body?.agentName || '').trim();
        const assignedBy = String(req.body?.assignedBy || agentName).trim();
        const campaignId = req.body?.campaignId || null;
        const force = parseBooleanFlag(req.body?.force);

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'Phone is required.' });
        }

        if (!agentName) {
            return res.status(400).json({ msg: 'agentName is required.' });
        }

        const existingList = await ConversationAssignment.find({ phone: normalizedPhone });
        const existing = pickLatestAssignment(existingList);

        if (existing && existing.status === 'active' && existing.assignedTo && existing.assignedTo !== agentName && !force) {
            return res.status(409).json({
                msg: `Este cliente ja esta em atendimento por ${existing.assignedTo}.`,
                code: 'CONVERSATION_ALREADY_ASSIGNED',
                assignment: existing,
            });
        }

        const now = new Date();

        if (existing) {
            const update = new ConversationAssignment({
                ...existing,
                assignedTo: agentName,
                assignedBy: assignedBy || existing.assignedBy || agentName,
                campaignId: campaignId || existing.campaignId || null,
                status: 'active',
                assignedAt: now,
                closedAt: null,
                updatedAt: now,
            });

            await update.save();
            emitRealtimeEvent('conversation.assignment.updated', {
                phone: normalizedPhone,
                assignment: update,
            });
            return res.json({ assignment: update });
        }

        const created = new ConversationAssignment({
            phone: normalizedPhone,
            campaignId,
            assignedTo: agentName,
            assignedBy: assignedBy || agentName,
            status: 'active',
            assignedAt: now,
            updatedAt: now,
        });

        try {
            await created.save();
            emitRealtimeEvent('conversation.assignment.updated', {
                phone: normalizedPhone,
                assignment: created,
            });
            return res.status(201).json({ assignment: created });
        } catch (createError) {
            const createMessage = String(createError?.message || '').toLowerCase();
            if (!createMessage.includes('duplicate key')) {
                throw createError;
            }

            const conflictList = await ConversationAssignment.find({ phone: normalizedPhone });
            const conflict = pickLatestAssignment(conflictList);

            if (!conflict) {
                throw createError;
            }

            if (conflict.status === 'active' && conflict.assignedTo && conflict.assignedTo !== agentName && !force) {
                return res.status(409).json({
                    msg: `Este cliente ja esta em atendimento por ${conflict.assignedTo}.`,
                    code: 'CONVERSATION_ALREADY_ASSIGNED',
                    assignment: conflict,
                });
            }

            const merged = new ConversationAssignment({
                ...conflict,
                assignedTo: agentName,
                assignedBy: assignedBy || conflict.assignedBy || agentName,
                campaignId: campaignId || conflict.campaignId || null,
                status: 'active',
                assignedAt: now,
                closedAt: null,
                updatedAt: now,
            });

            await merged.save();
            emitRealtimeEvent('conversation.assignment.updated', {
                phone: normalizedPhone,
                assignment: merged,
            });
            return res.json({ assignment: merged });
        }
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Release conversation ownership
// @route   POST /api/messages/conversations/:phone/release
exports.releaseConversation = async (req, res) => {
    try {
        const normalizedPhone = toSafePhone(req.params.phone);
        const agentName = String(req.body?.agentName || '').trim();
        const force = parseBooleanFlag(req.body?.force);

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'Phone is required.' });
        }

        const existingList = await ConversationAssignment.find({ phone: normalizedPhone, status: 'active' });
        const existing = pickLatestAssignment(existingList);

        if (!existing) {
            return res.status(404).json({ msg: 'No active assignment found for this phone.' });
        }

        if (agentName && existing.assignedTo && existing.assignedTo !== agentName && !force) {
            return res.status(409).json({
                msg: `Atendimento pertence a ${existing.assignedTo}.`,
                code: 'CONVERSATION_ASSIGNED_TO_OTHER_AGENT',
                assignment: existing,
            });
        }

        const closed = new ConversationAssignment({
            ...existing,
            status: 'closed',
            closedAt: new Date(),
            updatedAt: new Date(),
        });

        await closed.save();
        emitRealtimeEvent('conversation.assignment.released', {
            phone: normalizedPhone,
            assignment: closed,
        });
        res.json({ assignment: closed });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Register inbound message detected in WhatsApp Web
// @route   POST /api/messages/inbound
exports.registerInboundMessage = async (req, res) => {
    try {
        const rawPhone = req.body?.phone || req.body?.phoneOriginal || '';
        const normalized = normalizePhone(rawPhone);
        const normalizedPhone = normalized.normalized || String(rawPhone || '').replace(/\D/g, '');
        const text = String(req.body?.text || req.body?.processedMessage || '').trim();
        const name = String(req.body?.name || '').trim();
        const source = String(req.body?.source || 'whatsapp_web').trim();
        const candidateDate = new Date(req.body?.at || new Date());

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'phone is required.' });
        }

        if (!text) {
            return res.status(400).json({ msg: 'text is required.' });
        }

        const isCandidateDateValid = !Number.isNaN(candidateDate.getTime());
        const messageDate = isCandidateDateValid ? candidateDate : new Date();

        const history = await Message.find({ phone: normalizedPhone });
        const relatedMessages = Array.isArray(history) ? history : [];
        const relatedCampaignId = await resolveRelatedCampaignId({
            normalizedPhone,
            preferredCampaignId: req.body?.campaignId || null,
            relatedMessages,
        });

        if (!relatedCampaignId) {
            return res.status(202).json({
                ignored: true,
                reason: 'campaign_not_resolved',
                msg: 'Inbound reply ignored because campaign could not be resolved for this phone.',
            });
        }

        const recentInbound = relatedMessages
            .filter((item) => String(item.direction || 'outbound') === 'inbound')
            .sort((a, b) => getMessageDateMs(b) - getMessageDateMs(a))
            .slice(0, 25);

        const duplicate = recentInbound.find((item) => {
            const sameText = String(item.processedMessage || '').trim() === text;
            if (!sameText) return false;
            const delta = Math.abs(getMessageDateMs(item) - messageDate.getTime());
            return delta <= 2 * 60 * 1000;
        });

        if (duplicate) {
            emitRealtimeEvent('messages.inbound.duplicate', {
                phone: normalizedPhone,
                campaignId: relatedCampaignId,
                messageId: duplicate._id,
            });
            return res.json({ duplicate: true, message: duplicate });
        }

        const payload = {
            campaign: relatedCampaignId,
            phone: normalizedPhone,
            phoneOriginal: String(rawPhone || ''),
            searchTerms: normalized.searchTerms,
            name,
            variables: null,
            processedMessage: text,
            status: 'sent',
            direction: 'inbound',
            attemptCount: 1,
            lastError: null,
            error: null,
            sentAt: messageDate,
            updatedAt: messageDate,
            audit: [
                {
                    at: new Date(),
                    action: 'inbound_received',
                    details: 'Inbound reply captured from WhatsApp chat',
                    meta: {
                        source,
                    },
                },
            ],
        };

        const [createdMessage] = await Message.insertMany([payload]);
        emitRealtimeEvent('messages.inbound.received', {
            phone: normalizedPhone,
            campaignId: relatedCampaignId,
            message: createdMessage,
        });

        try {
            const existingAssignmentList = await ConversationAssignment.find({ phone: normalizedPhone, status: 'active' });
            const existingAssignment = pickLatestAssignment(existingAssignmentList);

            if (existingAssignment) {
                const updatedAssignment = new ConversationAssignment({
                    ...existingAssignment,
                    lastInboundAt: messageDate,
                    updatedAt: new Date(),
                });

                await updatedAssignment.save();
            }
        } catch (assignmentError) {
            if (!isConversationAssignmentsTableMissing(assignmentError)) {
                throw assignmentError;
            }
        }

        res.status(201).json({
            duplicate: false,
            message: createdMessage,
        });
        logSendResult({
            jobId: createdMessage?._id,
            status: 'sent',
            error: null,
            extra: { source, phone: normalizedPhone, campaignId: relatedCampaignId }
        });
    } catch (err) {
        console.error(err.message);
        logSendResult({
            jobId: null,
            status: 'failed',
            error: err,
            extra: { source: req.body?.source, phone: req.body?.phone, campaignId: req.body?.campaignId }
        });
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Register outbound message sent manually from atendimento
// @route   POST /api/messages/outbound/manual
exports.registerManualOutbound = async (req, res) => {
    try {
        const rawPhone = req.body?.phone || req.body?.phoneOriginal || '';
        const normalized = normalizePhone(rawPhone);
        const normalizedPhone = normalized.normalized || String(rawPhone || '').replace(/\D/g, '');
        const text = String(req.body?.text || req.body?.processedMessage || '').trim();
        const name = String(req.body?.name || '').trim();
        const source = String(req.body?.source || 'atendimento_direct').trim();
        const candidateDate = new Date(req.body?.at || new Date());

        if (!normalizedPhone) {
            return res.status(400).json({ msg: 'phone is required.' });
        }

        if (!text) {
            return res.status(400).json({ msg: 'text is required.' });
        }

        const isCandidateDateValid = !Number.isNaN(candidateDate.getTime());
        const messageDate = isCandidateDateValid ? candidateDate : new Date();

        const history = await Message.find({ phone: normalizedPhone });
        const relatedMessages = Array.isArray(history) ? history : [];
        const relatedCampaignId = await resolveRelatedCampaignId({
            normalizedPhone,
            preferredCampaignId: req.body?.campaignId || null,
            relatedMessages,
        });

        if (!relatedCampaignId) {
            return res.status(202).json({
                ignored: true,
                reason: 'campaign_not_resolved',
                msg: 'Outbound sent, but storage was skipped because campaign could not be resolved.',
            });
        }

        const recentOutbound = relatedMessages
            .filter((item) => String(item.direction || 'outbound') !== 'inbound')
            .sort((a, b) => getMessageDateMs(b) - getMessageDateMs(a))
            .slice(0, 25);

        const duplicate = recentOutbound.find((item) => {
            const sameText = String(item.processedMessage || '').trim() === text;
            if (!sameText) return false;
            const delta = Math.abs(getMessageDateMs(item) - messageDate.getTime());
            return delta <= 90 * 1000;
        });

        if (duplicate) {
            emitRealtimeEvent('messages.outbound.duplicate', {
                phone: normalizedPhone,
                campaignId: relatedCampaignId,
                messageId: duplicate._id,
            });
            return res.json({ duplicate: true, message: duplicate });
        }

        const payload = {
            campaign: relatedCampaignId,
            phone: normalizedPhone,
            phoneOriginal: String(rawPhone || ''),
            searchTerms: normalized.searchTerms,
            name,
            variables: null,
            processedMessage: text,
            status: 'sent',
            direction: 'outbound',
            attemptCount: 1,
            lastError: null,
            error: null,
            sentAt: messageDate,
            updatedAt: messageDate,
            audit: [
                {
                    at: new Date(),
                    action: 'manual_outbound_sent',
                    details: 'Message sent directly from atendimento',
                    meta: {
                        source,
                    },
                },
            ],
        };

        const [createdMessage] = await Message.insertMany([payload]);
        emitRealtimeEvent('messages.outbound.manual_sent', {
            phone: normalizedPhone,
            campaignId: relatedCampaignId,
            message: createdMessage,
        });

        res.status(201).json({
            duplicate: false,
            message: createdMessage,
        });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Get next pending message/job for the extension
// @route   GET /api/messages/next
exports.getNextJob = async (req, res) => {
    try {
        const requestedCampaignId = req.query.campaignId;
        const configuredStaleTimeoutMs = Number(process.env.STALE_PROCESSING_TIMEOUT_MS);
        const staleProcessingTimeoutMs = Number.isFinite(configuredStaleTimeoutMs) && configuredStaleTimeoutMs > 0
            ? configuredStaleTimeoutMs
            : 90 * 1000;

        // Step 1: Get active campaign IDs
        const activeCampaigns = await Campaign.find({ status: 'running' }).select('_id');
        const activeCampaignIds = activeCampaigns.map((c) => c._id);
        const activeCampaignIdSet = new Set(activeCampaignIds.map((id) => String(id)));

        if (activeCampaignIds.length === 0) {
            return res.json({ job: null });
        }

        let eligibleCampaignIds = activeCampaignIds;

        if (requestedCampaignId) {
            const requestedId = String(requestedCampaignId);
            if (!activeCampaignIdSet.has(requestedId)) {
                return res.json({ job: null });
            }

            eligibleCampaignIds = [requestedId];
        }

        // Safety: if a worker crashes after reserving a job, it can get stuck forever in "processing".
        // Requeue stale "processing" jobs back to "pending" so the system can recover automatically.
        try {
            const processingMessages = await Message.find({
                status: 'processing',
                campaign: { $in: eligibleCampaignIds },
            });

            const now = Date.now();
            const staleCandidates = (Array.isArray(processingMessages) ? processingMessages : [])
                .filter((item) => item && item._id)
                .filter((item) => {
                    const reference = item.lastAttemptAt || item.updatedAt || item.sentAt || item.createdAt || 0;
                    const startedAt = new Date(reference).getTime();
                    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
                    return (now - startedAt) > staleProcessingTimeoutMs;
                })
                .slice(0, 25);

            for (const candidate of staleCandidates) {
                const stuck = await Message.findById(candidate._id);
                if (!stuck || stuck.status !== 'processing') continue;

                const previousStatus = stuck.status;
                stuck.status = 'pending';
                stuck.sentAt = null;
                stuck.updatedAt = new Date();

                appendAudit(stuck, 'stale_requeued', 'Message moved back to queue after processing timeout', {
                    previousStatus,
                    timeoutMs: staleProcessingTimeoutMs,
                });

                await stuck.save();
                emitRealtimeEvent('messages.queue.requeued', {
                    messageId: stuck._id,
                    campaignId: stuck.campaign || null,
                    phone: stuck.phone || '',
                    previousStatus,
                    status: stuck.status,
                    updatedAt: stuck.updatedAt,
                });
            }
        } catch (requeueError) {
            // Best-effort only. If it fails, the queue still works for normal pending jobs.
        }

        // Step 2: Reserve next pending job (FIFO)
        const job = await Message.findOneAndUpdate(
            {
                status: 'pending',
                campaign: { $in: eligibleCampaignIds },
            },
            {
                status: 'processing',
            },
            { sort: { _id: 1 }, new: true }
        ).populate('campaign', 'name antiBan media');

        if (!job) {
            return res.json({ job: null });
        }

        // Step 3: Persist attempt metadata and audit trail
        const reservedMessage = await Message.findById(job._id);
        if (reservedMessage) {
            reservedMessage.attemptCount = (reservedMessage.attemptCount || 0) + 1;
            reservedMessage.lastAttemptAt = new Date();
            reservedMessage.updatedAt = new Date();

            appendAudit(
                reservedMessage,
                'processing_started',
                `Message processing started (attempt #${reservedMessage.attemptCount})`
            );

            await reservedMessage.save();

            job.attemptCount = reservedMessage.attemptCount;
            job.lastAttemptAt = reservedMessage.lastAttemptAt;
            job.audit = reservedMessage.audit;
            job.searchTerms = reservedMessage.searchTerms;
            job.phoneOriginal = reservedMessage.phoneOriginal;
        }

        emitRealtimeEvent('messages.queue.reserved', {
            messageId: job._id,
            campaignId: extractCampaignIdFromPayload(job.campaign),
            phone: job.phone,
            status: job.status,
            attemptCount: job.attemptCount || 0,
        });

        res.json({ job });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Update message status after attempt
// @route   PUT /api/messages/:id/status
exports.updateJobStatus = async (req, res) => {
    try {
        const { status, error } = req.body;
        const messageId = req.params.id || req.body.id;

        if (!messageId) {
            return res.status(400).json({ msg: 'Message id is required' });
        }

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }

        const previousStatus = message.status;

        message.status = status;
        message.updatedAt = new Date();

        if (status === 'sent') {
            message.sentAt = new Date();
            message.error = null;
            message.lastError = null;
        } else if (status === 'failed') {
            const errorMessage = error || 'Unknown send error';
            message.error = errorMessage;
            message.lastError = errorMessage;
        } else if (error) {
            message.error = error;
            message.lastError = error;
        }

        appendAudit(message, 'status_updated', `Status changed from ${previousStatus} to ${status}`, {
            previousStatus,
            status,
            error: error || null,
        });


        await message.save();
        logSendResult({
            jobId: message._id,
            status: message.status,
            error: message.error,
            extra: { previousStatus, phone: message.phone, campaignId: message.campaign }
        });
        emitRealtimeEvent('messages.status.updated', {
            messageId: message._id,
            campaignId: message.campaign || null,
            phone: message.phone || '',
            previousStatus,
            status: message.status,
            direction: message.direction || 'outbound',
            updatedAt: message.updatedAt,
        });

        const campaign = await Campaign.findById(message.campaign);
        if (campaign) {
            applyCampaignStatTransition(campaign, previousStatus, status);
            campaign.updatedAt = new Date();
            await campaign.save();
            emitRealtimeEvent('campaign.stats.updated', {
                campaignId: campaign._id,
                stats: campaign.stats,
                updatedAt: campaign.updatedAt,
            });
        }

        res.json(message);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Get audit trail for one message
// @route   GET /api/messages/:id/audit
exports.getMessageAudit = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }

        res.json({
            _id: message._id,
            status: message.status,
            phone: message.phone,
            phoneOriginal: message.phoneOriginal,
            error: message.error,
            attemptCount: message.attemptCount || 0,
            audit: message.audit || [],
        });
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Edit failed message payload (phone/text/name)
// @route   PATCH /api/messages/:id
exports.updateMessage = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }

        const changedFields = applyMessageEdits(message, req.body || {});

        message.updatedAt = new Date();
        appendAudit(message, 'edited', 'Message edited by user', { changedFields });

        await message.save();
        emitRealtimeEvent('messages.edited', {
            messageId: message._id,
            campaignId: message.campaign || null,
            phone: message.phone || '',
            changedFields,
            updatedAt: message.updatedAt,
        });

        res.json(message);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};

// @desc    Requeue a message after manual review
// @route   POST /api/messages/:id/retry
exports.retryMessage = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }

        const previousStatus = message.status;
        const changedFields = applyMessageEdits(message, req.body || {});

        message.status = 'pending';
        message.error = null;
        message.lastError = null;
        message.sentAt = null;
        message.updatedAt = new Date();

        appendAudit(message, 'retried', 'Message moved back to queue', {
            previousStatus,
            changedFields,
        });

        await message.save();
        emitRealtimeEvent('messages.retried', {
            messageId: message._id,
            campaignId: message.campaign || null,
            phone: message.phone || '',
            previousStatus,
            status: message.status,
            changedFields,
            updatedAt: message.updatedAt,
        });

        const campaign = await Campaign.findById(message.campaign);
        if (campaign) {
            applyCampaignStatTransition(campaign, previousStatus, 'pending');
            campaign.updatedAt = new Date();
            await campaign.save();
            emitRealtimeEvent('campaign.stats.updated', {
                campaignId: campaign._id,
                stats: campaign.stats,
                updatedAt: campaign.updatedAt,
            });
        }

        res.json(message);
    } catch (err) {
        console.error(err.message);
        const errorResponse = buildServerErrorResponse(err);
        res.status(errorResponse.statusCode).json(errorResponse.body);
    }
};
