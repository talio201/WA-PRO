import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    MagnifyingGlassIcon,
    ArrowPathIcon,
    PaperAirplaneIcon,
    TrashIcon,
    ClipboardIcon,
    DocumentDuplicateIcon,
    ArrowsRightLeftIcon,
    LockClosedIcon,
    UserIcon,
    VideoCameraIcon,
    MicrophoneIcon,
    PaperClipIcon,
    EllipsisHorizontalIcon,
    PhoneIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import {
    assignConversation,
    getConversationProtocols,
    getConversationHistory,
    getConversations,
    getHelpdeskQueues,
    openConversationProtocol,
    registerManualOutbound,
    releaseConversation,
    transferConversation,
    syncConversationHistory,
    updateConversationProtocolStatus,
    requestConversationHistorySync,
    uploadFile,
} from '../utils/api.js';
import { connectRealtime } from '../utils/realtime.js';
import './inbox-glass.css';

const AGENT_NAME_STORAGE_KEY = 'wa-manager-agent-name';
const ATTENDANCE_FALLBACK_REFRESH_INTERVAL_MS = 60000;
const ACTION_NOTICE_TIMEOUT_MS = 2200;
const imageUrlPattern = /(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg))/i;
const genericUrlPattern = /(https?:\/\/[^\s]+)/i;

const toTime = (value) => {
    if (!value) return '--:--';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const toDateTime = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleString();
};

const getMessageDate = (message) => new Date(message.updatedAt || message.sentAt || message.createdAt || 0).getTime();
const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');
const isSamePhone = (left, right) => {
    const normalizedLeft = normalizePhoneDigits(left);
    const normalizedRight = normalizePhoneDigits(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const readStoredAgentName = () => {
    if (typeof window === 'undefined') return '';
    return String(window.localStorage.getItem(AGENT_NAME_STORAGE_KEY) || '').trim();
};

const formatDayLabel = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((today - target) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Ontem';
    return date.toLocaleDateString();
};

const initialsFromName = (value) => {
    const clean = String(value || '').trim();
    if (!clean) return '??';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

const avatarTone = (value) => {
    const palette = [
        'linear-gradient(135deg, #007aff 0%, #5856d6 100%)',
        'linear-gradient(135deg, #34c759 0%, #30d158 100%)',
        'linear-gradient(135deg, #ff9f0a 0%, #ff375f 100%)',
        'linear-gradient(135deg, #64d2ff 0%, #0a84ff 100%)',
        'linear-gradient(135deg, #30b0c7 0%, #4f46e5 100%)',
    ];
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(index);
        hash |= 0;
    }
    return palette[Math.abs(hash) % palette.length];
};

const parseMessagePayload = (rawText) => {
    const source = String(rawText || '').trim();
    if (!source) {
        return {
            text: '',
            imageUrl: '',
            linkUrl: '',
        };
    }
    const imageMatch = source.match(imageUrlPattern);
    const imageUrl = imageMatch ? imageMatch[0] : '';
    const withoutImage = imageUrl ? source.replace(imageUrl, '').trim() : source;
    const linkMatch = withoutImage.match(genericUrlPattern);
    const linkUrl = linkMatch ? linkMatch[0] : '';
    const text = linkUrl ? withoutImage.replace(linkUrl, '').trim() : withoutImage;
    return {
        text,
        imageUrl,
        linkUrl,
    };
};

const isWarmConversation = (conversation) => {
    const lastAt = new Date(conversation?.lastAt || 0).getTime();
    if (!Number.isFinite(lastAt) || lastAt <= 0) return false;
    const elapsedMs = Date.now() - lastAt;
    return elapsedMs <= (15 * 60 * 1000) && String(conversation?.lastDirection || '') === 'inbound';
};

const sendDirectMessageViaExtension = () => Promise.reject(new Error('Envio via extensão desativado no ambiente SaaS.'));
const sendDirectMediaViaExtension = () => Promise.reject(new Error('Envio de mídia via extensão desativado no ambiente SaaS.'));
const openChatToolViaExtension = () => Promise.reject(new Error('Ferramentas de chat da extensão desativadas no ambiente SaaS.'));

const QUICK_EMOJIS = ['😀', '😊', '😉', '👍', '🔥', '🚀', '🎯', '🙏', '🤝', '💬'];
const PROTOCOL_STATUS_LABELS = {
    open: 'Aberto',
    in_progress: 'Em andamento',
    resolved: 'Resolvido',
    closed: 'Fechado',
};
const QUEUE_LABELS = {
    waiting: 'Fila de atendimento',
    in_attendance: 'Em atendimento',
    monitoring: 'Monitoramento',
};

const Inbox = () => {
    const [conversations, setConversations] = useState([]);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [syncingHistory, setSyncingHistory] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedPhone, setSelectedPhone] = useState('');
    const [composeText, setComposeText] = useState('');
    const [sending, setSending] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [releasing, setReleasing] = useState(false);
    const [onlyWithReplies, setOnlyWithReplies] = useState(true);
    const [onlyAssigned, setOnlyAssigned] = useState(false);
    const [agentName, setAgentName] = useState(readStoredAgentName);
    const [conversationError, setConversationError] = useState('');
    const [messageError, setMessageError] = useState('');
    const [assignmentUnavailable, setAssignmentUnavailable] = useState(false);
    const [attachmentSending, setAttachmentSending] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [realtimeStatus, setRealtimeStatus] = useState('connecting');
    const [lastRealtimeAt, setLastRealtimeAt] = useState('');
    const [actionNotice, setActionNotice] = useState('');
    const [messageActionId, setMessageActionId] = useState('');
    const [clipboardLoading, setClipboardLoading] = useState(false);
    const [helpdeskSummary, setHelpdeskSummary] = useState(null);
    const [queueOverview, setQueueOverview] = useState(null);
    const [protocols, setProtocols] = useState([]);
    const [protocolsLoading, setProtocolsLoading] = useState(false);
    const [protocolSubject, setProtocolSubject] = useState('');
    const [protocolDescription, setProtocolDescription] = useState('');
    const [protocolPriority, setProtocolPriority] = useState('normal');
    const [creatingProtocol, setCreatingProtocol] = useState(false);
    const [transferTargetAgent, setTransferTargetAgent] = useState('');
    const [transferReason, setTransferReason] = useState('');
    const [transferringConversation, setTransferringConversation] = useState(false);

    const fileInputRef = useRef(null);
    const selectedPhoneRef = useRef('');
    const realtimePendingRefreshRef = useRef({ conversations: false, messages: false });
    const realtimeRefreshTimerRef = useRef(null);
    const actionNoticeTimerRef = useRef(null);

    const pauseAutoRefresh = Boolean(composeText.trim() || sending || attachmentSending || messageActionId);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(AGENT_NAME_STORAGE_KEY, String(agentName || '').trim());
    }, [agentName]);

    useEffect(() => {
        setShowEmojiPicker(false);
    }, [selectedPhone]);

    useEffect(() => {
        selectedPhoneRef.current = selectedPhone;
    }, [selectedPhone]);

    useEffect(() => () => {
        if (realtimeRefreshTimerRef.current) {
            clearTimeout(realtimeRefreshTimerRef.current);
            realtimeRefreshTimerRef.current = null;
        }
        if (actionNoticeTimerRef.current) {
            clearTimeout(actionNoticeTimerRef.current);
            actionNoticeTimerRef.current = null;
        }
    }, []);

    const loadConversations = useCallback(async () => {
        try {
            setConversationError('');
            let nextConversations = [];
            try {
                const queuePayload = await getHelpdeskQueues({
                    limit: 500,
                    search: search.trim(),
                    agentId: String(agentName || '').trim(),
                });
                nextConversations = Array.isArray(queuePayload?.items) ? queuePayload.items : [];
                if (onlyWithReplies) {
                    nextConversations = nextConversations.filter((item) => Number(item.inboundCount || 0) > 0);
                }
                if (onlyAssigned) {
                    nextConversations = nextConversations.filter((item) => Boolean(item.assignment?.assignedTo));
                }
                setHelpdeskSummary(queuePayload?.summary || null);
                setQueueOverview(queuePayload?.queueOverview || null);
            } catch (queueError) {
                const data = await getConversations({
                    limit: 500,
                    search: search.trim(),
                    onlyWithReplies,
                    onlyAssigned,
                });
                nextConversations = Array.isArray(data) ? data : [];
            }
            setConversations(nextConversations);
            setSelectedPhone((current) => {
                if (!current && nextConversations.length > 0) {
                    return nextConversations[0].phone || '';
                }
                if (!current) return '';
                const stillExists = nextConversations.some((item) => isSamePhone(item.phone, current));
                if (stillExists) return current;
                if (nextConversations.length > 0) {
                    return nextConversations[0].phone || '';
                }
                return '';
            });
        } catch (error) {
            console.error('Failed to load conversations:', error);
            setConversationError(error?.message || 'Nao foi possivel carregar as conversas.');
        } finally {
            setLoading(false);
        }
    }, [agentName, onlyAssigned, onlyWithReplies, search]);

    const loadSelectedMessages = useCallback(async (targetPhone = '', options = {}) => {
        const phone = normalizePhoneDigits(targetPhone || selectedPhoneRef.current);
        const safeAgentId = String(options.agentId || agentName || '').trim();
        const shouldSync = options.sync !== false;

        if (!phone) {
            setConversationMessages([]);
            setMessageError('');
            return;
        }
        if (!safeAgentId) {
            setConversationMessages([]);
            setMessageError('Informe seu nome de atendimento para acessar o historico.');
            return;
        }

        try {
            setLoadingMessages(true);
            setMessageError('');

            if (shouldSync) {
                setSyncingHistory(true);
                try {
                    await requestConversationHistorySync(phone);
                    await new Promise(r => setTimeout(r, 900));
                } catch (syncError) {
                    console.warn('History sync warning:', syncError?.message || syncError);
                } finally {
                    setSyncingHistory(false);
                }
            }

            const data = await getConversationHistory(phone, {
                agentId: safeAgentId,
                limit: 2500,
            });

            const list = Array.isArray(data) ? data : [];
            list.sort((a, b) => getMessageDate(a) - getMessageDate(b));
            setConversationMessages(list);
        } catch (error) {
            console.error('Failed to load selected conversation messages:', error);
            setMessageError(error?.message || 'Nao foi possivel carregar o historico.');
        } finally {
            setLoadingMessages(false);
        }
    }, [agentName]);

    const loadConversationProtocols = useCallback(async (targetPhone = '') => {
        const phone = normalizePhoneDigits(targetPhone || selectedPhoneRef.current);
        if (!phone) {
            setProtocols([]);
            return;
        }
        try {
            setProtocolsLoading(true);
            const list = await getConversationProtocols(phone);
            setProtocols(Array.isArray(list) ? list : []);
        } catch (error) {
            console.warn('Failed to load support protocols:', error?.message || error);
            setProtocols([]);
        } finally {
            setProtocolsLoading(false);
        }
    }, []);

    const scheduleRealtimeRefresh = useCallback((next = {}) => {
        const pending = realtimePendingRefreshRef.current;
        pending.conversations = pending.conversations || Boolean(next.conversations);
        pending.messages = pending.messages || Boolean(next.messages);

        if (realtimeRefreshTimerRef.current) return;

        realtimeRefreshTimerRef.current = setTimeout(async () => {
            const shouldReloadConversations = realtimePendingRefreshRef.current.conversations;
            const shouldReloadMessages = realtimePendingRefreshRef.current.messages;

            realtimePendingRefreshRef.current = { conversations: false, messages: false };
            realtimeRefreshTimerRef.current = null;

            if (shouldReloadConversations) {
                await loadConversations();
            }
            if (shouldReloadMessages) {
                await loadSelectedMessages('', { sync: false });
            }
        }, 320);
    }, [loadConversations, loadSelectedMessages]);

    useEffect(() => {
        loadConversations();
    }, [loadConversations]);

    useEffect(() => {
        loadSelectedMessages(selectedPhone, { sync: true });
        loadConversationProtocols(selectedPhone);
    }, [loadConversationProtocols, loadSelectedMessages, selectedPhone]);

    useEffect(() => {
        const disposeRealtime = connectRealtime({
            onStatus: (status) => {
                setRealtimeStatus(status);
            },
            onEvent: (message) => {
                const eventName = String(message?.event || '');
                const payload = message?.data || {};
                setLastRealtimeAt(message?.at || new Date().toISOString());

                const payloadPhone = normalizePhoneDigits(payload.phone || payload?.message?.phone || '');
                const activePhone = normalizePhoneDigits(selectedPhoneRef.current);
                const sameConversation = Boolean(payloadPhone && activePhone && payloadPhone === activePhone);

                if (eventName.startsWith('messages.')) {
                    scheduleRealtimeRefresh({
                        conversations: true,
                        messages: sameConversation,
                    });
                    return;
                }
                if (eventName.startsWith('conversation.assignment')) {
                    scheduleRealtimeRefresh({
                        conversations: true,
                        messages: sameConversation,
                    });
                    return;
                }
                if (eventName.startsWith('conversation.protocol')) {
                    scheduleRealtimeRefresh({
                        conversations: true,
                        messages: sameConversation,
                    });
                    if (sameConversation) {
                        loadConversationProtocols(payloadPhone);
                    }
                    return;
                }
                if (eventName.startsWith('campaign.')) {
                    scheduleRealtimeRefresh({
                        conversations: true,
                        messages: false,
                    });
                }
            },
        });

        return () => {
            disposeRealtime();
        };
    }, [loadConversationProtocols, scheduleRealtimeRefresh]);

    useEffect(() => {
        if (realtimeStatus === 'connected') return undefined;
        const interval = setInterval(() => {
            if (pauseAutoRefresh) return;
            loadConversations();
            loadSelectedMessages('', { sync: false });
        }, ATTENDANCE_FALLBACK_REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [realtimeStatus, pauseAutoRefresh, loadConversations, loadSelectedMessages]);

    const selectedConversation = useMemo(() => (
        conversations.find((conversation) => isSamePhone(conversation.phone, selectedPhone)) || null
    ), [conversations, selectedPhone]);

    const selectedAssignment = selectedConversation?.assignment || null;
    const trimmedAgent = String(agentName || '').trim();
    const isCurrentAgentOwner = Boolean(trimmedAgent && selectedAssignment?.assignedTo === trimmedAgent);

    const timeline = useMemo(() => {
        const rows = [];
        let lastLabel = '';

        conversationMessages.forEach((message) => {
            const dateValue = message.updatedAt || message.sentAt || message.createdAt;
            const label = formatDayLabel(dateValue);

            if (label !== lastLabel) {
                rows.push({
                    key: `separator-${label}-${message._id}`,
                    type: 'separator',
                    label,
                });
                lastLabel = label;
            }

            rows.push({
                key: message._id,
                type: 'message',
                payload: message,
            });
        });

        return rows;
    }, [conversationMessages]);

    const applyLocalOutboundUpdate = useCallback((outboundText) => {
        if (!selectedConversation?.phone) return;
        const nowIso = new Date().toISOString();
        const text = String(outboundText || '').trim();
        if (!text) return;

        const syntheticMessage = {
            _id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            campaign: selectedConversation.campaignId || null,
            phone: selectedConversation.phone,
            phoneOriginal: selectedConversation.phone,
            name: selectedConversation.name || '',
            processedMessage: text,
            status: 'sent',
            direction: 'outbound',
            sentAt: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
        };

        setConversationMessages((prev) => [...prev, syntheticMessage]);
        setConversations((prev) => {
            const mapped = prev.map((item) => {
                if (!isSamePhone(item.phone, selectedConversation.phone)) return item;
                return {
                    ...item,
                    outboundCount: Number(item.outboundCount || 0) + 1,
                    lastMessage: text,
                    lastDirection: 'outbound',
                    lastStatus: 'sent',
                    lastAt: nowIso,
                };
            });
            mapped.sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime());
            return mapped;
        });
    }, [selectedConversation]);

    const showActionFeedback = useCallback((text) => {
        setActionNotice(String(text || '').trim());
        if (actionNoticeTimerRef.current) {
            clearTimeout(actionNoticeTimerRef.current);
        }
        actionNoticeTimerRef.current = setTimeout(() => {
            setActionNotice('');
            actionNoticeTimerRef.current = null;
        }, ACTION_NOTICE_TIMEOUT_MS);
    }, []);

    const realtimeMeta = useMemo(() => {
        if (realtimeStatus === 'connected') {
            return {
                label: `Tempo real ativo${lastRealtimeAt ? ` (${toTime(lastRealtimeAt)})` : ''}`,
                className: 'is-connected',
            };
        }
        if (realtimeStatus === 'connecting') {
            return {
                label: 'Conectando websocket...',
                className: 'is-connecting',
            };
        }
        return {
            label: 'Fallback ativo (sincronizacao por intervalo)',
            className: 'is-disconnected',
        };
    }, [lastRealtimeAt, realtimeStatus]);

    const handleRefreshConversationPanel = async () => {
        await loadConversations();
        await loadSelectedMessages('', { sync: true });
    };

    const ensureConversationAssigned = async (conversation, force = false) => {
        if (!conversation) return true;
        if (assignmentUnavailable) return true;

        const safeAgent = String(agentName || '').trim();
        if (!safeAgent) {
            alert('Informe seu nome de atendimento para assumir conversas.');
            return false;
        }

        if (conversation.assignment?.assignedTo === safeAgent && conversation.assignment?.status === 'active') {
            return true;
        }

        try {
            setAssigning(true);
            await assignConversation(conversation.phone, {
                agentName: safeAgent,
                assignedBy: safeAgent,
                campaignId: conversation.campaignId || null,
                force,
            });
            await loadConversations();
            return true;
        } catch (error) {
            const message = String(error?.message || '');
            const normalized = message.toLowerCase();
            const alreadyAssigned = normalized.includes('ja esta em atendimento');
            const tableMissing = normalized.includes('supabase table not found')
                || normalized.includes('could not find the table')
                || normalized.includes('conversation_assignments');

            if (tableMissing) {
                setAssignmentUnavailable(true);
                return true;
            }

            if (alreadyAssigned && !force) {
                const shouldTakeOver = window.confirm(`${message}\n\nDeseja assumir este atendimento mesmo assim?`);
                if (shouldTakeOver) {
                    return ensureConversationAssigned(conversation, true);
                }
            }

            alert(message || 'Nao foi possivel assumir o atendimento.');
            return false;
        } finally {
            setAssigning(false);
        }
    };

    const handleSelectConversation = async (conversation) => {
        if (!conversation?.phone) return;
        setSelectedPhone(conversation.phone);
        const assigned = await ensureConversationAssigned(conversation, false);
        if (!assigned) return;
        await loadSelectedMessages(conversation.phone, {
            sync: true,
            agentId: String(agentName || '').trim(),
        });
    };

    const handleReleaseConversation = async () => {
        if (!selectedConversation || assignmentUnavailable) return;
        const safeAgent = String(agentName || '').trim();
        if (!safeAgent) {
            alert('Informe seu nome de atendimento para liberar a conversa.');
            return;
        }
        try {
            setReleasing(true);
            await releaseConversation(selectedConversation.phone, { agentName: safeAgent });
            await loadConversations();
        } catch (error) {
            const message = String(error?.message || '');
            const normalized = message.toLowerCase();
            if (normalized.includes('supabase table not found') || normalized.includes('could not find the table')) {
                setAssignmentUnavailable(true);
                return;
            }
            alert(message || 'Nao foi possivel liberar este atendimento.');
        } finally {
            setReleasing(false);
        }
    };

    const handleTransferConversation = async () => {
        if (!selectedConversation) return;
        const safeFrom = String(agentName || '').trim();
        const safeTo = String(transferTargetAgent || '').trim();
        if (!safeFrom) {
            alert('Informe seu nome para transferir atendimento.');
            return;
        }
        if (!safeTo) {
            alert('Informe o atendente de destino.');
            return;
        }
        try {
            setTransferringConversation(true);
            await transferConversation(selectedConversation.phone, {
                fromAgent: safeFrom,
                toAgent: safeTo,
                reason: String(transferReason || '').trim(),
            });
            setTransferReason('');
            setTransferTargetAgent('');
            showActionFeedback(`Atendimento transferido para ${safeTo}.`);
            await loadConversations();
            await loadConversationProtocols(selectedConversation.phone);
        } catch (error) {
            alert(error?.message || 'Nao foi possivel transferir o atendimento.');
        } finally {
            setTransferringConversation(false);
        }
    };

    const handleOpenProtocol = async () => {
        if (!selectedConversation) return;
        const safeAgent = String(agentName || '').trim();
        const safeSubject = String(protocolSubject || '').trim();
        if (!safeSubject) {
            alert('Informe o assunto do protocolo.');
            return;
        }
        try {
            setCreatingProtocol(true);
            await openConversationProtocol(selectedConversation.phone, {
                openedBy: safeAgent,
                subject: safeSubject,
                description: String(protocolDescription || '').trim(),
                priority: protocolPriority,
                customerName: selectedConversation.name || '',
                campaignId: selectedConversation.campaignId || null,
            });
            setProtocolSubject('');
            setProtocolDescription('');
            setProtocolPriority('normal');
            showActionFeedback('Protocolo aberto no atendimento.');
            await loadConversations();
            await loadConversationProtocols(selectedConversation.phone);
        } catch (error) {
            alert(error?.message || 'Nao foi possivel abrir protocolo.');
        } finally {
            setCreatingProtocol(false);
        }
    };

    const handleProtocolStatusChange = async (protocol, nextStatus) => {
        if (!protocol?._id) return;
        try {
            await updateConversationProtocolStatus(protocol._id, {
                status: nextStatus,
                updatedBy: String(agentName || '').trim(),
            });
            showActionFeedback(`Protocolo ${protocol.protocolNumber || ''} atualizado.`);
            await loadConversations();
            await loadConversationProtocols(selectedConversation?.phone || '');
        } catch (error) {
            alert(error?.message || 'Nao foi possivel atualizar protocolo.');
        }
    };

    const openWhatsAppChat = () => {
        if (!selectedConversation) return;
        const url = `https://web.whatsapp.com/send?phone=${selectedConversation.phone}`;
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    action: 'SET_ACTIVE_CHAT_CONTEXT',
                    phone: selectedConversation.phone,
                });
            }
        } catch (error) {
        }
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url });
            return;
        }
        window.open(url, '_blank');
    };

    const sendDirectAndStoreOutbound = useCallback(async ({
        phone,
        name = '',
        text,
        campaignId = null,
        source = 'atendimento_direct',
        searchTerms = [],
    }) => {
        const safePhone = normalizePhoneDigits(phone);
        const safeText = String(text || '').trim();
        if (!safePhone) throw new Error('Telefone invalido para envio.');
        if (!safeText) throw new Error('Mensagem vazia para envio.');

        await sendDirectMessageViaExtension({
            phone: safePhone,
            text: safeText,
            searchTerms: Array.isArray(searchTerms) ? searchTerms.filter(Boolean) : [],
            source,
            focusTab: false,
        });

        return registerManualOutbound({
            phone: safePhone,
            name: String(name || ''),
            text: safeText,
            campaignId: campaignId || null,
            source,
            at: new Date().toISOString(),
        });
    }, []);

    const sendReply = async () => {
        if (!selectedConversation || !composeText.trim()) return;
        const assigned = await ensureConversationAssigned(selectedConversation);
        if (!assigned) return;

        try {
            setSending(true);
            const outboundText = composeText.trim();
            const storedOutbound = await sendDirectAndStoreOutbound({
                phone: selectedConversation.phone,
                name: selectedConversation.name || '',
                text: outboundText,
                campaignId: selectedConversation.campaignId || null,
                source: 'atendimento_direct',
                searchTerms: [
                    selectedConversation.phone,
                    selectedConversation.name,
                ].filter(Boolean),
            });
            applyLocalOutboundUpdate(outboundText);
            setComposeText('');
            showActionFeedback('Mensagem enviada sem sair da tela.');
            if (storedOutbound?.ignored) {
                alert('Mensagem enviada no WhatsApp, mas nao foi registrada no historico por falta de campanha vinculada.');
            }
        } catch (error) {
            console.error('Failed to send reply:', error);
            alert(error?.message || 'Nao foi possivel enviar a resposta.');
        } finally {
            setSending(false);
        }
    };

    const handleComposeKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            sendReply();
        }
    };

    const insertEmoji = (emoji) => {
        setComposeText((current) => `${current}${emoji}`);
    };

    const copyMessageText = async (message) => {
        const text = String(message?.processedMessage || '').trim();
        if (!text) {
            showActionFeedback('Nada para copiar nesta mensagem.');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            showActionFeedback('Mensagem copiada.');
        } catch (error) {
            alert('Nao foi possivel copiar para a area de transferencia.');
        }
    };

    const pasteFromClipboardToComposer = async () => {
        try {
            setClipboardLoading(true);
            const clipText = await navigator.clipboard.readText();
            const safeText = String(clipText || '').trim();
            if (!safeText) {
                showActionFeedback('Area de transferencia vazia.');
                return;
            }
            setComposeText((current) => (current ? `${current}\n${safeText}` : safeText));
            showActionFeedback('Texto colado no campo de resposta.');
        } catch (error) {
            alert('Seu navegador bloqueou leitura da area de transferencia.');
        } finally {
            setClipboardLoading(false);
        }
    };

    const resendMessageToCurrentConversation = async (message) => {
        if (!selectedConversation) return;
        const text = String(message?.processedMessage || '').trim();
        if (!text) {
            showActionFeedback('Mensagem sem conteudo para reenvio.');
            return;
        }
        const assigned = await ensureConversationAssigned(selectedConversation);
        if (!assigned) return;

        const actionId = `resend-${message._id}`;
        try {
            setMessageActionId(actionId);
            const storedOutbound = await sendDirectAndStoreOutbound({
                phone: selectedConversation.phone,
                name: selectedConversation.name || '',
                text,
                campaignId: selectedConversation.campaignId || null,
                source: 'atendimento_resend',
                searchTerms: [
                    selectedConversation.phone,
                    selectedConversation.name,
                ].filter(Boolean),
            });
            applyLocalOutboundUpdate(text);
            showActionFeedback('Mensagem reenviada.');
            if (storedOutbound?.ignored) {
                alert('Mensagem reenviada no WhatsApp, mas sem registro no historico por falta de campanha vinculada.');
            }
        } catch (error) {
            alert(error?.message || 'Nao foi possivel reenviar a mensagem.');
        } finally {
            setMessageActionId('');
        }
    };

    const forwardMessageToAnotherPhone = async (message) => {
        if (!selectedConversation) return;
        const text = String(message?.processedMessage || '').trim();
        if (!text) {
            showActionFeedback('Mensagem sem conteudo para encaminhar.');
            return;
        }

        const targetInput = window.prompt('Encaminhar para qual numero? (DDI+DDD+numero)');
        if (!targetInput) return;

        const targetPhone = normalizePhoneDigits(targetInput);
        if (targetPhone.length < 8) {
            alert('Numero de destino invalido.');
            return;
        }

        const targetConversation = conversations.find((item) => isSamePhone(item.phone, targetPhone)) || null;
        if (targetConversation) {
            const assigned = await ensureConversationAssigned(targetConversation);
            if (!assigned) return;
        }

        const targetCampaignId = targetConversation?.campaignId
            || selectedConversation.campaignId
            || message.campaign
            || null;
        
        const actionId = `forward-${message._id}`;
        try {
            setMessageActionId(actionId);
            const storedOutbound = await sendDirectAndStoreOutbound({
                phone: targetPhone,
                name: targetConversation?.name || '',
                text,
                campaignId: targetCampaignId,
                source: 'atendimento_forward',
                searchTerms: [
                    targetPhone,
                    targetConversation?.name,
                ].filter(Boolean),
            });

            if (isSamePhone(targetPhone, selectedConversation.phone)) {
                applyLocalOutboundUpdate(text);
            } else {
                await loadConversations();
            }

            showActionFeedback(`Mensagem encaminhada para ${targetPhone}.`);
            if (storedOutbound?.ignored) {
                alert('Encaminhamento enviado no WhatsApp, mas sem registro no historico por falta de campanha vinculada.');
            }
        } catch (error) {
            alert(error?.message || 'Nao foi possivel encaminhar a mensagem.');
        } finally {
            setMessageActionId('');
        }
    };

    const openToolInWhatsApp = async (tool) => {
        if (!selectedConversation) return;
        try {
            await openChatToolViaExtension({
                phone: selectedConversation.phone,
                searchTerms: [
                    selectedConversation.phone,
                    selectedConversation.name,
                ].filter(Boolean),
                tool,
            });
        } catch (error) {
            openWhatsAppChat();
        }
    };

    const handleClickAttachment = async () => {
        if (!selectedConversation) return;
        const assigned = await ensureConversationAssigned(selectedConversation);
        if (!assigned) return;
        if (!fileInputRef.current) return;
        fileInputRef.current.click();
    };

    const processFileUpload = async (file) => {
        if (!file || !selectedConversation) return;
        const assigned = await ensureConversationAssigned(selectedConversation);
        if (!assigned) return;

        try {
            setAttachmentSending(true);
            const uploaded = await uploadFile(file);
            const caption = composeText.trim();

            if (caption) {
                await sendDirectMessageViaExtension({
                    phone: selectedConversation.phone,
                    text: caption,
                    searchTerms: [selectedConversation.phone, selectedConversation.name].filter(Boolean),
                    source: 'atendimento_direct_media_caption',
                    focusTab: false,
                });
            }

            await sendDirectMediaViaExtension({
                phone: selectedConversation.phone,
                searchTerms: [
                    selectedConversation.phone,
                    selectedConversation.name,
                ].filter(Boolean),
                media: {
                    fileUrl: uploaded.fileUrl,
                    mimetype: uploaded.mimetype,
                },
                caption: '',
                source: 'atendimento_direct_media',
                focusTab: false,
            });

            const historyText = caption
                ? `${caption}\n${uploaded.fileUrl}`
                : uploaded.fileUrl;

            const storedOutbound = await registerManualOutbound({
                phone: selectedConversation.phone,
                name: selectedConversation.name || '',
                text: historyText,
                campaignId: selectedConversation.campaignId || null,
                source: 'atendimento_direct_media',
                at: new Date().toISOString(),
            });

            applyLocalOutboundUpdate(historyText);
            setComposeText('');
            showActionFeedback('Arquivo enviado com sucesso.');
            if (storedOutbound?.ignored) {
                alert('Arquivo enviado no WhatsApp, mas nao foi registrada no historico por falta de campanha vinculada.');
            }
        } catch (error) {
            alert(error?.message || 'Nao foi possivel enviar o arquivo.');
        } finally {
            setAttachmentSending(false);
        }
    };

    const handleAttachmentSelected = async (event) => {
        const file = event.target?.files?.[0];
        if (file) {
            await processFileUpload(file);
        }
        if (event.target) {
            event.target.value = '';
        }
    };

    const handlePaste = async (event) => {
        const items = event.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    await processFileUpload(file);
                }
            }
        }
    };

    const handleMicButton = async () => {
        if (!selectedConversation) return;
        await openToolInWhatsApp('mic');
        showActionFeedback('WhatsApp pronto para gravacao manual de audio.');
    };

    return (
        <div className="inbox-glass-root">
            <div className="inbox-glass-ambient" aria-hidden="true">
                <div className="inbox-blob inbox-blob-1" />
                <div className="inbox-blob inbox-blob-2" />
                <div className="inbox-blob inbox-blob-3" />
            </div>
            <div className="inbox-glass-shell">
                <aside className="inbox-sidebar">
                    <div className="inbox-sidebar-header">
                        <div className="inbox-header-top">
                            <div>
                                <h2>Atendimento</h2>
                                <p>Respostas de clientes das campanhas</p>
                            </div>
                            <div className="inbox-header-actions">
                                <button type="button" className="icon-btn" onClick={handleRefreshConversationPanel} aria-label="Atualizar lista">
                                    <RefreshCw size={16} />
                                </button>
                                <button type="button" className="icon-btn" aria-label="Mais opcoes">
                                    <MoreHorizontal size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="agent-input-wrap">
                            <label htmlFor="agentName">Seu nome de atendimento</label>
                            <input
                                id="agentName"
                                type="text"
                                value={agentName}
                                onChange={(event) => setAgentName(event.target.value)}
                                placeholder="Ex: Maria - Suporte"
                            />
                        </div>
                        <div className="search-wrap">
                            <Search size={14} />
                            <input
                                type="text"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por nome, numero ou agente"
                            />
                        </div>
                        <div className="filter-wrap">
                            <label className="inline-toggle">
                                <input
                                    type="checkbox"
                                    checked={onlyWithReplies}
                                    onChange={(event) => setOnlyWithReplies(event.target.checked)}
                                />
                                So com resposta
                            </label>
                            <button
                                type="button"
                                onClick={() => setOnlyAssigned((prev) => !prev)}
                                className={`chip-btn ${onlyAssigned ? 'is-active' : ''}`}
                            >
                                Em atendimento
                            </button>
                        </div>
                        <div className={`realtime-strip ${realtimeMeta.className}`}>
                            <span className="realtime-dot" />
                            <span>{realtimeMeta.label}</span>
                        </div>
                        {actionNotice && <div className="soft-info">{actionNotice}</div>}
                        {assignmentUnavailable && (
                            <div className="soft-warning">
                                Ownership compartilhado indisponivel ate criar a tabela `conversation_assignments` no Supabase.
                            </div>
                        )}
                        {conversationError && <div className="soft-error">{conversationError}</div>}
                    </div>
                    <div className="conversation-list">
                        {loading ? (
                            <div className="conversation-placeholder">Carregando conversas...</div>
                        ) : conversations.length === 0 ? (
                            <div className="conversation-placeholder">Nenhuma conversa encontrada para os filtros atuais.</div>
                        ) : conversations.map((conversation) => {
                            const assignment = conversation.assignment;
                            const isSelected = isSamePhone(selectedPhone, conversation.phone);
                            const ownedByCurrentAgent = Boolean(trimmedAgent && assignment?.assignedTo === trimmedAgent);
                            const ownedByAnotherAgent = Boolean(assignment?.assignedTo && assignment.assignedTo !== trimmedAgent);
                            const warm = isWarmConversation(conversation);
                            return (
                                <button
                                    key={conversation.phone}
                                    type="button"
                                    className={`conversation-item ${isSelected ? 'is-active' : ''}`}
                                    onClick={() => handleSelectConversation(conversation)}
                                >
                                    <div className="avatar-wrap">
                                        <div className="avatar" style={{ background: avatarTone(conversation.phone || conversation.name) }}>
                                            {initialsFromName(conversation.name || conversation.phone)}
                                        </div>
                                        <span className={`presence-dot ${warm ? 'is-online' : 'is-idle'}`} />
                                    </div>
                                    <div className="conversation-meta">
                                        <div className="conversation-top">
                                            <span className="conversation-name">{conversation.name || conversation.phone}</span>
                                            <span className="conversation-time">{toTime(conversation.lastAt)}</span>
                                        </div>
                                        <div className="conversation-bottom">
                                            <span className="conversation-preview">
                                                {String(conversation.lastDirection || 'outbound') === 'inbound' ? 'Cliente: ' : 'Voce: '}
                                                {conversation.lastMessage || '-'}
                                            </span>
                                            {conversation.inboundCount > 0 && (
                                                <span className="badge badge-unread">{conversation.inboundCount}</span>
                                            )}
                                        </div>
                                        <div className="conversation-foot">
                                            {conversation.queueType && (
                                                <span className="owner-badge">
                                                    <ListTodo size={11} />
                                                    {QUEUE_LABELS[conversation.queueType] || conversation.queueType}
                                                </span>
                                            )}
                                            {Number(conversation.protocolOpenCount || 0) > 0 && (
                                                <span className="owner-badge is-other">
                                                    <FileText size={11} />
                                                    {conversation.protocolOpenCount} protocolos
                                                </span>
                                            )}
                                            {conversation.failedCount > 0 && <span className="badge badge-failed">{conversation.failedCount} falhas</span>}
                                            {assignment?.assignedTo && (
                                                <span className={`owner-badge ${ownedByCurrentAgent ? 'is-self' : ownedByAnotherAgent ? 'is-other' : ''}`}>
                                                    <Lock size={11} />
                                                    {ownedByCurrentAgent ? 'Em seu atendimento' : `Atendendo: ${assignment.assignedTo}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </aside>
                <main className="chat-main">
                    {selectedConversation ? (
                        <>
                            <header className="chat-header">
                                <div className="chat-profile">
                                    <div className="avatar avatar-lg" style={{ background: avatarTone(selectedConversation.phone || selectedConversation.name) }}>
                                        {initialsFromName(selectedConversation.name || selectedConversation.phone)}
                                    </div>
                                    <div>
                                        <h3>{selectedConversation.name || selectedConversation.phone}</h3>
                                        <p>{selectedConversation.phone}</p>
                                        <div className="chat-chips">
                                            <span className="pill">Respostas: {selectedConversation.inboundCount || 0}</span>
                                            <span className="pill">Enviadas: {selectedConversation.outboundCount || 0}</span>
                                            {selectedConversation.queueType && (
                                                <span className="pill">Fila: {QUEUE_LABELS[selectedConversation.queueType] || selectedConversation.queueType}</span>
                                            )}
                                            <span className="pill">Protocolos abertos: {selectedConversation.protocolOpenCount || 0}</span>
                                            {selectedAssignment?.assignedTo && (
                                                <span className={`pill ${isCurrentAgentOwner ? 'is-owner' : 'is-owner-other'}`}>
                                                    Atendendo: {selectedAssignment.assignedTo}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="chat-actions">
                                    <button
                                        type="button"
                                        onClick={() => ensureConversationAssigned(selectedConversation, false)}
                                        disabled={assigning || assignmentUnavailable}
                                        className="header-btn primary"
                                    >
                                        {assigning ? 'Assumindo...' : 'Assumir'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleReleaseConversation}
                                        disabled={releasing || assignmentUnavailable}
                                        className="header-btn"
                                    >
                                        {releasing ? 'Liberando...' : 'Liberar'}
                                    </button>
                                    <button type="button" className="icon-btn" aria-label="Video" onClick={openWhatsAppChat}><VideoCameraIcon className="w-4 h-4" /></button>
                                    <button type="button" className="icon-btn" aria-label="Ligar" onClick={openWhatsAppChat}><PhoneIcon className="w-4 h-4" /></button>
                                    <button type="button" className="icon-btn" onClick={openWhatsAppChat} aria-label="Abrir no WhatsApp"><ArrowsRightLeftIcon className="w-4 h-4" /></button>
                                </div>
                            </header>
                            <section className="helpdesk-panel">
                                <div className="helpdesk-summary-row">
                                    <span className="helpdesk-summary-pill">Fila: {helpdeskSummary?.waiting || 0}</span>
                                    <span className="helpdesk-summary-pill">Em atendimento: {helpdeskSummary?.inAttendance || 0}</span>
                                    <span className="helpdesk-summary-pill">Monitoramento: {helpdeskSummary?.monitoring || 0}</span>
                                    <span className="helpdesk-summary-pill">Protocolos: {helpdeskSummary?.protocolsOpen || 0}</span>
                                </div>
                                <div className="helpdesk-grid">
                                    <div className="helpdesk-card">
                                        <h4><ArrowsRightLeftIcon className="w-4 h-4 inline" /> Transferir atendimento</h4>
                                        <input
                                            type="text"
                                            placeholder="Atendente destino"
                                            value={transferTargetAgent}
                                            onChange={(event) => setTransferTargetAgent(event.target.value)}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Motivo (opcional)"
                                            value={transferReason}
                                            onChange={(event) => setTransferReason(event.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="header-btn"
                                            onClick={handleTransferConversation}
                                            disabled={transferringConversation || !selectedConversation}
                                        >
                                            {transferringConversation ? 'Transferindo...' : 'Transferir'}
                                        </button>
                                    </div>
                                    <div className="helpdesk-card">
                                        <h4><DocumentDuplicateIcon className="w-4 h-4 inline" /> Abrir protocolo</h4>
                                        <input
                                            type="text"
                                            placeholder="Assunto do protocolo"
                                            value={protocolSubject}
                                            onChange={(event) => setProtocolSubject(event.target.value)}
                                        />
                                        <select
                                            value={protocolPriority}
                                            onChange={(event) => setProtocolPriority(event.target.value)}
                                        >
                                            <option value="low">Prioridade baixa</option>
                                            <option value="normal">Prioridade normal</option>
                                            <option value="high">Prioridade alta</option>
                                            <option value="urgent">Urgente</option>
                                        </select>
                                        <textarea
                                            rows={2}
                                            value={protocolDescription}
                                            onChange={(event) => setProtocolDescription(event.target.value)}
                                            placeholder="Descricao do atendimento/problema"
                                        />
                                        <button
                                            type="button"
                                            className="header-btn primary"
                                            onClick={handleOpenProtocol}
                                            disabled={creatingProtocol || !selectedConversation}
                                        >
                                            {creatingProtocol ? 'Abrindo...' : 'Abrir protocolo'}
                                        </button>
                                    </div>
                                </div>
                                <div className="helpdesk-protocols">
                                    <div className="helpdesk-protocols-head">
                                        <h4><ClipboardIcon className="w-4 h-4 inline" /> Protocolos da conversa</h4>
                                        <span>
                                            Worker queue: {queueOverview?.queues?.workerOutbound?.waiting ?? 0} pendentes
                                        </span>
                                    </div>
                                    {protocolsLoading ? (
                                        <div className="conversation-placeholder">Carregando protocolos...</div>
                                    ) : protocols.length === 0 ? (
                                        <div className="conversation-placeholder">Sem protocolos abertos/registrados.</div>
                                    ) : (
                                        <div className="protocol-list">
                                            {protocols.slice(0, 8).map((protocol) => (
                                                <div key={protocol._id} className="protocol-item">
                                                    <div>
                                                        <strong>{protocol.protocolNumber}</strong>
                                                        <p>{protocol.subject || '-'}</p>
                                                        <small>
                                                            {PROTOCOL_STATUS_LABELS[protocol.status] || protocol.status} · {toDateTime(protocol.updatedAt || protocol.openedAt)}
                                                        </small>
                                                    </div>
                                                    <div className="protocol-actions">
                                                        {protocol.status !== 'in_progress' && (
                                                            <button type="button" onClick={() => handleProtocolStatusChange(protocol, 'in_progress')}>Atender</button>
                                                        )}
                                                        {protocol.status !== 'resolved' && (
                                                            <button type="button" onClick={() => handleProtocolStatusChange(protocol, 'resolved')}>Resolver</button>
                                                        )}
                                                        {protocol.status !== 'closed' && (
                                                            <button type="button" onClick={() => handleProtocolStatusChange(protocol, 'closed')}>Fechar</button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </section>
                            <section className="chat-messages" aria-live="polite">
                                {loadingMessages ? (
                                    <div className="conversation-placeholder">
                                        {syncingHistory ? 'Sincronizando historico do WhatsApp...' : 'Carregando historico...'}
                                    </div>
                                ) : messageError ? (
                                    <div className="soft-error">{messageError}</div>
                                ) : timeline.length === 0 ? (
                                    <div className="conversation-placeholder">Nenhuma mensagem no historico.</div>
                                ) : timeline.map((item) => {
                                    if (item.type === 'separator') {
                                        return (
                                            <div key={item.key} className="day-separator">
                                                <span>{item.label}</span>
                                            </div>
                                        );
                                    }
                                    const message = item.payload;
                                    const isInbound = String(message.direction || 'outbound') === 'inbound';
                                    const parsed = parseMessagePayload(message.processedMessage || '');
                                    const statusLabel = isInbound ? 'recebida' : (message.status || 'pending');
                                    const resendActionId = `resend-${message._id}`;
                                    const forwardActionId = `forward-${message._id}`;
                                    const isResending = messageActionId === resendActionId;
                                    const isForwarding = messageActionId === forwardActionId;

                                    return (
                                        <article key={item.key} className={`msg-row ${isInbound ? 'is-received' : 'is-sent'}`}>
                                            <div className="msg-bubble">
                                                {parsed.text && <p>{parsed.text}</p>}
                                                {!parsed.text && !parsed.imageUrl && !parsed.linkUrl && (
                                                    <p>{message.processedMessage || '-'}</p>
                                                )}
                                                {parsed.imageUrl && <img src={parsed.imageUrl} alt="media" className="msg-image" loading="lazy" />}
                                                {parsed.linkUrl && (
                                                    <a href={parsed.linkUrl} target="_blank" rel="noreferrer" className="msg-link">
                                                        {parsed.linkUrl}
                                                    </a>
                                                )}
                                            </div>
                                            <div className="msg-meta">
                                                <span className={`status-mini ${isInbound ? 'is-received' : ''}`}>{statusLabel}</span>
                                                <time>{toDateTime(message.updatedAt || message.sentAt || message.createdAt)}</time>
                                            </div>
                                            <div className="msg-actions">
                                                <button type="button" className="msg-action-btn" onClick={() => copyMessageText(message)} title="Copiar mensagem">
                                                    <DocumentDuplicateIcon className="w-3 h-3" /> Copiar
                                                </button>
                                                <button
                                                    type="button"
                                                    className="msg-action-btn"
                                                    onClick={() => forwardMessageToAnotherPhone(message)}
                                                    disabled={isForwarding || Boolean(messageActionId && !isForwarding)}
                                                    title="Encaminhar mensagem"
                                                >
                                                    <ArrowsRightLeftIcon className="w-3 h-3" /> {isForwarding ? 'Encaminhando...' : 'Encaminhar'}
                                                </button>
                                                {!isInbound && (
                                                    <button
                                                        type="button"
                                                        className="msg-action-btn"
                                                        onClick={() => resendMessageToCurrentConversation(message)}
                                                        disabled={isResending || Boolean(messageActionId && !isResending)}
                                                        title="Reenviar mensagem"
                                                    >
                                                        <ArrowPathIcon className="w-3 h-3" /> {isResending ? 'Reenviando...' : 'Reenviar'}
                                                    </button>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </section>
                            <footer className="chat-input-area">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="*/*"
                                    className="hidden-file-input"
                                    onChange={handleAttachmentSelected}
                                />
                                {showEmojiPicker && (
                                    <div className="emoji-panel" role="menu" aria-label="Selecionar emoji">
                                        {QUICK_EMOJIS.map((emoji) => (
                                            <button key={emoji} type="button" className="emoji-btn" onClick={() => insertEmoji(emoji)}>
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="chat-input-shell">
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        aria-label="Anexar arquivo"
                                        onClick={handleClickAttachment}
                                        disabled={attachmentSending}
                                    >
                                        <PaperClipIcon className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        aria-label="Colar do clipboard"
                                        onClick={pasteFromClipboardToComposer}
                                        disabled={clipboardLoading}
                                    >
                                        <ClipboardIcon className="w-4 h-4" />
                                    </button>
                                    <textarea
                                        rows={2}
                                        value={composeText}
                                        onChange={(event) => setComposeText(event.target.value)}
                                        onKeyDown={handleComposeKeyDown}
                                        onPaste={handlePaste}
                                        placeholder="Digite uma resposta para envio direto no WhatsApp (Ctrl+Enter para enviar)"
                                    />
                                    <button
                                        type="button"
                                        className={`icon-btn ${showEmojiPicker ? 'active-tool' : ''}`}
                                        aria-label="Emoji"
                                        onClick={() => setShowEmojiPicker((prev) => !prev)}
                                    >
                                        <EllipsisHorizontalIcon className="w-4 h-4" />
                                    </button>
                                    <button type="button" className="icon-btn" aria-label="Audio" onClick={handleMicButton}><MicrophoneIcon className="w-4 h-4" /></button>
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || attachmentSending || clipboardLoading || !composeText.trim()}
                                        className="icon-btn send"
                                        aria-label="Enviar"
                                    >
                                        {sending ? <ArrowPathIcon className="w-4 h-4" /> : <PaperAirplaneIcon className="w-4 h-4" />}
                                    </button>
                                </div>
                            </footer>
                        </>
                    ) : (
                        <div className="empty-chat">
                            <UserIcon className="w-5 h-5" />
                            <p>Selecione uma conversa para iniciar o atendimento.</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Inbox;