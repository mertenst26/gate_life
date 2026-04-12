import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '@gate-life/shared';

type MessageHandler = (msg: WSMessage) => void;

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // ms, capped at last value

export function useWebSocket(sessionId: string | null, userId: string | null, combatantId?: string | null) {
  const wsRef          = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef    = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef     = useRef(0);
  const destroyedRef   = useRef(false); // set on cleanup to stop reconnect loops

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const send = useCallback((msg: { type: string; payload: unknown }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    destroyedRef.current = false;

    function connect() {
      if (destroyedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyedRef.current) { ws.close(); return; }
        attemptRef.current = 0; // reset backoff on success
        setConnected(true);
        ws.send(JSON.stringify({
          type: 'join_session',
          payload: { session_id: sessionId, user_id: userId, combatant_id: combatantId },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          const handlers = handlersRef.current.get(msg.type);
          if (handlers) {
            for (const handler of handlers) handler(msg);
          }
          const wildcardHandlers = handlersRef.current.get('*');
          if (wildcardHandlers) {
            for (const handler of wildcardHandlers) handler(msg);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror — handle reconnect there
      };

      ws.onclose = () => {
        if (destroyedRef.current) return;
        setConnected(false);
        wsRef.current = null;

        // Exponential backoff reconnect
        const delay = RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)];
        attemptRef.current += 1;
        console.log(`[ws] disconnected — reconnecting in ${delay}ms (attempt ${attemptRef.current})`);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      destroyedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionId, userId, combatantId]);

  return { connected, send, subscribe };
}
