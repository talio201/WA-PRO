const DEFAULT_WS_URL = 'ws://localhost:3000/ws';

function safeParseMessage(raw) {
    try {
        return JSON.parse(String(raw || '{}'));
    } catch (error) {
        return null;
    }
}

export function connectRealtime({
    onEvent = () => {},
    onStatus = () => {},
    wsUrl = DEFAULT_WS_URL,
} = {}) {
    let socket = null;
    let isDisposed = false;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let attempt = 0;

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

        const backoff = Math.min(15000, (1000 * (2 ** attempt)) + Math.floor(Math.random() * 400));
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
            } catch (error) {
                // Ignore heartbeat write errors.
            }
        }, 25000);
    };

    const connect = () => {
        if (isDisposed) return;

        clearTimers();
        onStatus('connecting');

        try {
            socket = new WebSocket(wsUrl);
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
            if (!message) return;
            if (message.type !== 'event') return;

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

    connect();

    return () => {
        isDisposed = true;
        clearTimers();
        onStatus('disconnected');

        if (socket) {
            try {
                socket.close();
            } catch (error) {
                // Ignore close errors.
            }
        }
    };
}
