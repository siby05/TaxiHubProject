import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

// Connects once per authenticated session and joins the user's room on the
// server (see backend/server.js), so booking/complaint events pushed with
// io.to(userId).emit(...) reach exactly this browser tab.
export function useSocket(handlers) {
  const { token } = useAuthStore();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token } });

    const bound = Object.entries(handlersRef.current || {}).map(([event, fn]) => {
      const wrapped = (...args) => handlersRef.current[event]?.(...args);
      socket.on(event, wrapped);
      return [event, wrapped];
    });

    return () => {
      bound.forEach(([event, wrapped]) => socket.off(event, wrapped));
      socket.disconnect();
    };
  }, [token]);
}
