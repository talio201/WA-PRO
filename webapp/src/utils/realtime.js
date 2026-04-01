import { ensureSessionToken, getRuntimeConfig, getRuntimeConfigSync, runtimeConfigReady } from './runtimeConfig.js';
import { ensureSupabase } from '../auth/AuthContext.jsx';

const DEFAULT_WS_URL = getRuntimeConfigSync().backendWsUrl;

function safeParseMessage(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (_error) {
    return null;
  }
}

function mapSupabaseEvent(table = '') {
  if (table === 'messages') return 'messages.changed';
  if (table === 'campaigns') return 'campaign.changed';
  if (table === 'conversation_assignments') return 'conversation.assignment.changed';
  if (table === 'contacts') return 'contacts.changed';
  return 'db.changed';
}

function shouldIgnoreWsEventWhenSupabase(eventName = '') {
  return (
    eventName.startsWith('messages.')
    || eventName.startsWith('campaign.')
    || eventName.startsWith('conversation.assignment')
    || eventName.startsWith('contacts.')
  );
}

async function connectSupabaseRealtime({
  onEvent = () => {},
  onStatus = () => {},
} = {}) {
  const sb = await ensureSupabase();
  await runtimeConfigReady;
  const config = await getRuntimeConfig();
  const agentId = String(config.agentId || '').trim();
  if (!agentId) {
    throw new Error('Supabase realtime missing agentId');
  }

  const channel = sb.channel(`tenant:${agentId}`);

  const register = (table) => {
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      filter: `tenant_id=eq.${agentId}`,
    }, (payload) => {
      onEvent({
        type: 'event',
        event: mapSupabaseEvent(table),
        data: payload || {},
        at: new Date().toISOString(),
      });
    });
  };

  register('messages');
  register('campaigns');
  register('conversation_assignments');
  register('contacts');

  const statusHandler = (status) => {
    if (status === 'SUBSCRIBED') onStatus('connected');
    if (status === 'CHANNEL_ERROR') onStatus('error');
    if (status === 'CLOSED') onStatus('disconnected');
    if (status === 'TIMED_OUT') onStatus('error');
  };

  channel.subscribe(statusHandler);

  return () => {
    try {
      sb.removeChannel(channel);
    } catch (_error) {}
  };
}

export function connectRealtime({
  onEvent = () => {},
  onStatus = () => {},
  wsUrl = DEFAULT_WS_URL,
  includeBotActivity = true,
} = {}) {
  let socket = null;
  let isDisposed = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let attempt = 0;
  let supabaseActive = false;
  let disposeSupabase = () => {};

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (isDisposed) return;
    const backoff = Math.min(15000, 1000 * 2 ** attempt + Math.floor(Math.random() * 400));
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      connect();
    }, backoff);
  };

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', at: Date.now() }));
        }
      } catch (_error) {}
    }, 25000);
  };

  const connect = async () => {
    if (isDisposed) return;
    clearTimers();
    onStatus('connecting');
    try {
      await runtimeConfigReady;
      const config = await getRuntimeConfig();
      const resolvedUrl = new URL(wsUrl || config.backendWsUrl);

      let token = config.accessToken || '';
      if (!token) {
        const session = await ensureSessionToken();
        token = session?.token || '';
      }
      if (!token) {
        throw new Error('Realtime connection blocked: missing access token.');
      }

      resolvedUrl.searchParams.set('access_token', token);
      if (config.agentId) {
        resolvedUrl.searchParams.set('agentId', config.agentId);
      }

      socket = new WebSocket(resolvedUrl.toString());
    } catch (error) {
      onStatus('error');
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      attempt = 0;
      onStatus('connected');
      startHeartbeat();
    };

    socket.onmessage = (event) => {
      const message = safeParseMessage(event.data);
      if (!message || message.type !== 'event') return;
      const eventName = String(message?.event || '');
      if (supabaseActive && shouldIgnoreWsEventWhenSupabase(eventName)) return;
      if (!includeBotActivity && eventName === 'bot.live_activity') return;
      onEvent(message);
    };

    socket.onerror = () => {
      onStatus('error');
    };

    socket.onclose = () => {
      onStatus('disconnected');
      clearTimers();
      scheduleReconnect();
    };
  };

  const connectSupabase = async () => {
    try {
      onStatus('connecting');
      disposeSupabase = await connectSupabaseRealtime({
        onEvent,
        onStatus,
      });
      supabaseActive = true;
    } catch (_error) {
      supabaseActive = false;
    }
  };

  connectSupabase().finally(() => {
    if (!supabaseActive || includeBotActivity) {
      connect();
    }
  });

  return () => {
    isDisposed = true;
    clearTimers();
    onStatus('disconnected');
    disposeSupabase();
    if (socket) {
      try {
        socket.close();
      } catch (_error) {}
    }
  };
}
