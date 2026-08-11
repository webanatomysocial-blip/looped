import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { initDB } from './db';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import approvalRoutes from './routes/approvals';
import assetRoutes from './routes/assets';
import notificationRoutes from './routes/notifications';
import messageRoutes from './routes/messages';
import reportRoutes from './routes/reports';
import categoryRoutes from './routes/categories';
import internalChatRoutes from './routes/internal-chat';
import emailRoutes from './routes/emails';
import contentRoutes from './routes/content';
import seoRoutes, { publicSeoRouter } from './routes/seo';
import adsRoutes, { publicAdsRouter } from './routes/ads';
import capacityRoutes from './routes/capacity';
import timeLogsRoutes from './routes/time-logs';
import contactFormsRoutes, { publicContactFormsRouter } from './routes/contact-forms';
import { startEmailScheduler } from './services/scheduler';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public contact-forms endpoints (embed config + submit): mounted before the
// global CORS policy below, since embedded WordPress sites call these
// cross-origin and set their own permissive CORS headers per-route.
app.use('/api/public/contact-forms', publicContactFormsRouter);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'https://agency.webanatomy.in'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options(/.*/, cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'https://agency.webanatomy.in'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan(':method :url :status :response-time ms - :res[content-length]'));

// Uploads served only via authenticated /api/assets/:id/download

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/internal-chat', internalChatRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/public/seo', publicSeoRouter);
app.use('/api/ads', adsRoutes);
app.use('/api/public/ads', publicAdsRouter);
app.use('/api/capacity', capacityRoutes);
app.use('/api/time-logs', timeLogsRoutes);
app.use('/api/contact-forms', contactFormsRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve built frontend in production (frontend/dist → backend/public via build script)
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../public');
  app.use(express.static(frontendDist));
  // SPA fallback — use app.use (Express 5 no longer accepts '*' wildcard in app.get)
  app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      res.status(404).json({ error: 'Not found' });
    } else {
      
      res.sendFile(path.join(frontendDist, 'index.html'));
    }
  });
}

initDB()
  .then(() => {
    startEmailScheduler();
    app.listen(PORT, () => console.log(`Agency API running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });

export default app;
