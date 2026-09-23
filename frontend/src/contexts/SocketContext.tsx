import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { internalChatApi } from '../services/api';

interface SocketContextValue {
  socket: Socket | null;
  joinChat: (chatId: number) => void;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, joinChat: () => {} });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshUser } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!user) return;
    const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:4001' : window.location.origin;
    const s = io(socketUrl, {
      transports: ['websocket'],
    });
    socketRef.current = s;
    forceUpdate(n => n + 1);

    // Join user room + all their chat rooms
    internalChatApi.listChats().then(r => {
      const chatIds = (r.data || []).map((c: any) => c.id);
      s.emit('join', { userId: user.id, chatIds });
    }).catch(() => {
      s.emit('join', { userId: user.id, chatIds: [] });
    });

    s.on('permissions_updated', () => { refreshUser().catch(() => {}); });

    return () => { s.disconnect(); socketRef.current = null; };
  }, [user?.id]);

  const joinChat = (chatId: number) => {
    socketRef.current?.emit('join-chat', { chatId });
  };

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, joinChat }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
