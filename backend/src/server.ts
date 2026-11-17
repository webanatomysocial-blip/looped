import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { io } from './socket';
dotenv.config();
// Production only: the WhatsApp assistant's non-secret settings are compiled into the code (assistant/productionDefaults.ts).
// Values already set in the server's .env always win, and the AI key must stay in the server's .env, never in git.
const assistantSettingsFileLoaded: boolean = require('./assistant/productionDefaults').applyProductionDefaults();

import { initDB, getDB } from './db';
import { repairSkippedStageTickets, recoverInterruptedTransitions } from './services/xlr8';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import taskRoutes, { publicTaskRouter } from './routes/tasks';
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
import localSeoRoutes from './routes/local-seo';
import appSettingsRoutes from './routes/app-settings';
import xlr8Routes from './routes/xlr8';
import calendarRoutes from './routes/calendar';
import regularisationRoutes from './routes/regularisation';
import assistantRoutes from './assistant/routes';
import { requirePage } from './middleware/auth';
import { apiLimiter, writeLimiter, sensitiveLimiter, publicLinkLimiter } from './middleware/rateLimits';
import { startEmailScheduler, startRecurringTaskScheduler, scheduleWaitingReviewers } from './services/scheduler';

const app = express();
const httpServer = createServer(app);
io.attach(httpServer);

// Socket.io: user joins their own room by user id, and chat rooms by chat id
io.on('connection', (socket) => {
  socket.on('join', ({ userId, chatIds }: { userId: number; chatIds: number[] }) => {
    socket.join(`user:${userId}`);
    for (const id of chatIds) socket.join(`chat:${id}`);
  });
  socket.on('join-chat', ({ chatId }: { chatId: number }) => socket.join(`chat:${chatId}`));

  // WebRTC call signaling
  socket.on('call-offer', ({ to, from, offer, chatId, callerName, callType }) => {
    io.to(`user:${to}`).emit('call-incoming', { from, offer, chatId, callerName, callType });
  });
  socket.on('call-answer', ({ to, answer }) => {
    io.to(`user:${to}`).emit('call-answered', { answer });
  });
  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(`user:${to}`).emit('ice-candidate', { candidate });
  });
  socket.on('call-end', ({ to }) => {
    io.to(`user:${to}`).emit('call-ended');
  });
  socket.on('call-reject', ({ to }) => {
    io.to(`user:${to}`).emit('call-rejected');
  });
});

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
    // OpenStreetMap blocks tile requests that arrive without a Referer
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
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

// Rate limits (per session; see middleware/rateLimits.ts)
app.use('/api/public', publicLinkLimiter);
app.use('/api', apiLimiter, writeLimiter);
app.use(['/api/users', '/api/auth/logout-all'], sensitiveLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
// APIs that serve exactly one website page also require that page's permission (S9)
app.use('/api/reports', requirePage('/reports'), reportRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/internal-chat', internalChatRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/content', requirePage('/content'), contentRoutes);
app.use('/api/seo', requirePage('/seo'), seoRoutes);
app.use('/api/public/seo', publicSeoRouter);
app.use('/api/public/task', publicTaskRouter);
app.use('/api/ads', requirePage('/ads'), adsRoutes);
app.use('/api/public/ads', publicAdsRouter);
app.use('/api/capacity', capacityRoutes);
app.use('/api/time-logs', timeLogsRoutes);
app.use('/api/contact-forms', requirePage('/contact-forms'), contactFormsRoutes);
app.use('/api/local-seo', requirePage('/local-seo'), localSeoRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/xlr8', xlr8Routes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/regularisation', regularisationRoutes);
app.use('/api/assistant', assistantRoutes);
// Phase 4.5: admin-only control centre API. No action handlers are registered, so nothing can be retried or executed.
let assistantConfig: import('./assistant/config').AssistantConfig | null = null;
let assistantProblems: string[] = [];
// Reads the assistant settings (server .env, then assistant.production.env, then an AI key saved from the dashboard)
function loadAssistant(): void {
  try {
    assistantConfig = require('./assistant/config').loadAssistantConfig();
    assistantProblems = [];
    const c = assistantConfig!;
    // Safe summary only: no key, no secret, no phone numbers
    console.log(`[assistant] configured: enabled=${c.enabled} provider=${c.ai.provider} model=${c.ai.model ?? 'none'} timezone=${c.timezone} execution=${c.queue.executionEnabled ? 'ENABLED' : 'disabled'}`);
    if (c.queue.executionEnabled && !c.enabled) console.warn('[assistant] execution is switched on but the assistant is off: nothing will run');
  } catch (e: any) {
    assistantConfig = null;
    assistantProblems = Array.isArray(e?.problems) ? e.problems : [String(e?.message ?? e)];
    console.warn('[assistant] configuration is INVALID, so the assistant stays OFF and nothing will run:');
    for (const p of assistantProblems) console.warn(`[assistant]   - ${p}`);
    if (process.env.ASSISTANT_EXECUTION_ENABLED === 'true') console.error('[assistant] execution was requested but the configuration is invalid: execution stays OFF');
  }
}
loadAssistant();

// Starts the assistant worker and WhatsApp once, when the configuration is valid. Safe to call again: it only starts what is not running.
let assistantStarted = false;
async function startAssistantServices(): Promise<void> {
  if (assistantStarted || !assistantConfig?.enabled) return;
  assistantStarted = true;
  const { ticketRegistry, stillVerified } = require('./assistant/actions');
  const { recoverOnStartup, startWorker } = require('./assistant/worker');
  const registry = ticketRegistry(getDB());
  const settings = {
    workerId: `web-${process.pid}`, maxAttempts: assistantConfig.queue.maxAttempts, leaseSeconds: assistantConfig.queue.leaseSeconds,
    contextTtlSeconds: assistantConfig.contextTtlSeconds, executionEnabled: assistantConfig.queue.executionEnabled,
  };
  const deps = { db: getDB(), registry, stillVerified: (id: number) => stillVerified(getDB(), id), settings };
  await recoverOnStartup(deps).catch(() => console.error('[assistant-worker] startup recovery failed'));
  startWorker(deps);
  // WhatsApp channel: off by default; needs the assistant on as well
  try {
    const { loadWhatsAppConfig } = require('./assistant/whatsapp/config');
    const waConfig = loadWhatsAppConfig();
    if (waConfig.enabled) {
      const { startWhatsApp } = require('./assistant/whatsapp/runtime');
      const c = assistantConfig;
      await startWhatsApp(getDB(), {
        ai: new (require('./assistant/aiUsage').RecordingAIProvider)(require('./assistant/ai').createAIProvider(c.ai), getDB), timezone: c.timezone, contextTtlSeconds: c.contextTtlSeconds,
        confirmationTtlSeconds: c.confirmationTtlSeconds, queueExpirySeconds: c.queue.queueExpirySeconds, executionEnabled: c.queue.executionEnabled,
      }, waConfig).then(() => console.log('[whatsapp] adapter started; pairing is needed until a session exists'))
        .catch((e: any) => console.error('[whatsapp] did not start:', String(e?.message ?? 'error').slice(0, 160)));
    }
  } catch (e: any) {
    console.warn('[whatsapp] configuration is INVALID, so WhatsApp stays OFF:');
    for (const p of (Array.isArray(e?.problems) ? e.problems : [])) console.warn(`[whatsapp]   - ${p}`);
  }
}

// A key saved in the dashboard: used when the server's .env has none, then the assistant starts without a restart
async function useStoredAiKey(): Promise<void> {
  if (process.env.ASSISTANT_AI_API_KEY || process.env.OPENAI_API_KEY) return;
  const key = await require('./assistant/settingsStore').loadAiKey(getDB());
  if (key) { process.env.ASSISTANT_AI_API_KEY = key; loadAssistant(); }
}
const assistantRegistry = new (require('./assistant/executor').HandlerRegistry)();
app.use('/api/assistant-admin', require('./assistant/adminApi').createAssistantAdminRouter({ getDB, registry: assistantRegistry, config: () => assistantConfig,
  setup: () => ({ problems: assistantProblems, nodeEnv: process.env.NODE_ENV ?? 'not set', settingsFileLoaded: assistantSettingsFileLoaded }),
  onAiKeySaved: async (key: string) => { process.env.ASSISTANT_AI_API_KEY = key; loadAssistant(); await startAssistantServices(); return { running: !!assistantConfig?.enabled, problems: assistantProblems }; }, whatsappStatus: () => require('./assistant/whatsapp/runtime').getWhatsAppStatus(), whatsappPairing: () => require('./assistant/whatsapp/runtime').getPairingCode(), whatsappNewPairing: () => require('./assistant/whatsapp/runtime').requestNewPairing(), whatsappGroups: () => require('./assistant/whatsapp/runtime').listWhatsAppGroups() }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve uploaded files (assets, chat attachments) — always, dev and prod
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
  .then(async () => {
    const recovered = await recoverInterruptedTransitions(getDB()).catch((e) => { console.error('[xlr8] recovery failed', e); return 0; });
    if (recovered) console.log(`[xlr8] restored ${recovered} interrupted ticket transition(s)`);
    await repairSkippedStageTickets(getDB()).catch((e) => console.error('[xlr8] skip repair failed', e));
    // Assistant worker and WhatsApp: only when the assistant is on (an AI key saved in the dashboard counts too)
    await useStoredAiKey().catch(() => console.error('[assistant] stored settings could not be read'));
    await startAssistantServices();
    startEmailScheduler();
    startRecurringTaskScheduler();
    scheduleWaitingReviewers(getDB()).catch((err) => console.error('[scheduler] Waiting reviews error:', err));
    httpServer.listen(PORT, () => console.log(`Agency API running on port ${PORT}`));
    httpServer.setTimeout(120000);
  })
  .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });

export default app;
