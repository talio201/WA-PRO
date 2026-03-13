/**
 * Webapp realtime.js — WebSocket authenticated via Supabase session.
 */
import { ensureSupabase } from '../auth/AuthContext.jsx';

export function connectRealtime(wsUrl, { onMessage, onStatus } = {}) {
  let socket = null;
  let destroyed = false;
  let reconnectTimer = null;
  let attempt = 0;

  async function connect() {
    if (destroyed) return;
    onStatus?.('connecting');
    try {
      const sb = await ensureSupabase();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token || '';
      if (!token) { onStatus?.('disconnected'); return; }

      const base = wsUrl || (location.protocol === 'https:' ? `wss://${location.host}/ws` : `ws://${location.host}/ws`);
      const url = new URL(base);
      url.searchParams.set('access_token', token);
      const agentId = localStorage.getItem('emidia_agent_id') || '';
      if (agentId) url.searchParams.set('agentId', agentId);

      socket = new WebSocket(url.toString());

      socket.onopen = () => {
        attempt = 0;
        onStatus?.('connected');
      };
      socket.onmessage = (ev) => {
        try { onMessage?.(JSON.parse(ev.data)); } catch (_) {}
      };
      socket.onclose = () => {
        if (destroyed) return;
        onStatus?.('disconnected');
        const delay = Math.min(30000, 1200 * Math.pow(1.5, attempt++));
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket?.close();
      };
    } catch (err) {
      onStatus?.('disconnected');
      const delay = Math.min(30000, 1200 * Math.pow(1.5, attempt++));
      reconnectTimer = setTimeout(connect, delay);
    }
  }

  connect();

  return {
    disconnect() {
      destroyed = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
    send(data) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    },
  };
}
