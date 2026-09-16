import { Server as SocketServer } from 'socket.io';

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173', 'https://agency.webanatomy.in', 'https://loooped.in', 'https://www.loooped.in'];

export const io = new SocketServer({
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});
