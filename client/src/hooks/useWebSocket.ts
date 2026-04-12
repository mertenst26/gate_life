import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '@gate-life/shared';

type MessageHandler = (msg: WSMessage) => void;

export function useWebSocket(sessionId: string | null, userId: string | null, combatantId?: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
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
          for (const handler of handlers) {
            handler(msg);
          }
        }
        // Also fire a wildcard handler
        const wildcardHandlers = handlersRef.current.get('*');
        if (wildcardHandlers) {
          for (const handler of wildcardHandlers) {
            handler(msg);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, userId, combatantId]);

  return { connected, send, subscribe };
}
