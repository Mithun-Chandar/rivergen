/**
 * Template: init-websocket-provider
 *
 * Produces: apps/web/src/providers/WebSocketProvider.tsx
 *
 * Written once by rivergen init. Never modified by rivergen gen.
 * Event bindings come from ws-bindings/_index.ts (getAllWsBindings).
 * The loop replaces per-event socket.on() calls — provider stays thin forever.
 */
export function renderWebSocketProvider(): string {
  return `"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { applyRealtimeEventToCache } from "../lib/cache/state-cache";
import { getAllWsBindings } from "./ws-bindings/_index";

interface WebSocketContextValue {
  socket: Socket | null;
  connected: boolean;
  enabled: boolean;
  error: string | null;
  reconnect: () => void;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(
  null,
);

function getSocketUrl(): string | null {
  // Next.js:  set NEXT_PUBLIC_WS_URL in .env.local
  // Vite:     set VITE_WS_URL in .env  (swap line below for: import.meta.env.VITE_WS_URL)
  // Generic:  set WS_URL in .env
  const url =
    process.env.NEXT_PUBLIC_WS_URL?.trim() ||
    process.env.WS_URL?.trim();
  return url || null;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const reconnect = useCallback(() => {
    socketRef.current?.connect();
  }, []);

  useEffect(() => {
    const socketUrl = getSocketUrl();
    if (!socketUrl) {
      setEnabled(false);
      setConnected(false);
      setError(null);
      socketRef.current = null;
      return;
    }

    setEnabled(true);

    const socket = io(socketUrl, {
      autoConnect: false,
      transports: ["websocket"],
    });

    const routeEvent = (eventName: string) => (payload: unknown) => {
      applyRealtimeEventToCache(
        eventName,
        payload as Record<string, unknown> | null | undefined,
        queryClient,
      );
    };

    // Lifecycle handlers
    socket.on("connect", () => {
      setConnected(true);
      setError(null);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (socketError: Error) => {
      setConnected(false);
      setError(socketError.message || "WebSocket connection failed");
    });

    // Register all domain event bindings from ws-bindings slices
    for (const event of getAllWsBindings()) {
      socket.on(event, routeEvent(event));
    }

    socket.connect();
    socketRef.current = socket;

    return () => {
      socket.off();
      socket.disconnect();
      socketRef.current = null;
      setEnabled(false);
      setConnected(false);
    };
  }, [queryClient]);

  const value = useMemo<WebSocketContextValue>(
    () => ({
      socket: socketRef.current,
      connected,
      enabled,
      error,
      reconnect,
    }),
    [connected, enabled, error, reconnect],
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used inside WebSocketProvider");
  }
  return context;
}
`;
}
