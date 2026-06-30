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
import seoRoutes from './routes/seo';
import { startEmailScheduler } from './services/scheduler';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'https://agency.webanatomy.in'],
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

app.get('/health', (_req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

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
