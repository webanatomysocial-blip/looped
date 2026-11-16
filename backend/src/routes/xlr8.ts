import { Router, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import { sendServiceError } from '../services/access';
import * as x from '../services/xlr8';

const router = Router();
router.use(authMiddleware);

type Handler = (req: AuthRequest) => Promise<unknown>;
const run = (fn: Handler, status = 200) => async (req: AuthRequest, res: Response) => {
  try { const out = await fn(req); res.status(status).json(out ?? { ok: true }); }
  catch (err) { sendServiceError(res, err, 'xlr8'); }
};
const actor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role, name: req.user!.name, email: req.user!.email, pod: req.user!.pod });
const id = (req: AuthRequest) => req.params.id as string;

// ── Ticket types (admin) ──
router.get('/ticket-types', run(() => x.listTicketTypes(getDB())));
router.post('/ticket-types', run((req) => x.saveTicketType(getDB(), actor(req), null, req.body), 201));
router.put('/ticket-types/:id', run((req) => x.saveTicketType(getDB(), actor(req), Number(req.params.id), req.body)));
router.delete('/ticket-types/:id', run((req) => x.deleteTicketType(getDB(), actor(req), id(req))));

// ── Tickets: read ──
router.get('/tickets', run((req) => x.listTickets(getDB(), actor(req), { project_id: req.query.project_id })));
router.get('/tickets/:id', run((req) => x.getTicket(getDB(), actor(req), id(req))));
router.get('/tickets/:id/log', run((req) => x.getTicketLog(getDB(), actor(req), id(req))));
router.get('/tickets/:id/return-stages', run((req) => x.getReturnStages(getDB(), actor(req), id(req))));

// ── Tickets: create + assignment ──
router.post('/tickets', run((req) => x.createTicket(getDB(), actor(req), req.body), 201));
router.put('/tickets/:id/stage-assignments', run((req) => x.updateStageAssignments(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/accept', run((req) => x.startAssignment(getDB(), actor(req), id(req))));
router.post('/tickets/:id/assign', run((req) => x.assignTicket(getDB(), actor(req), id(req), req.body)));

// ── Stage people: accept / decline ──
router.post('/tickets/:id/stage-pre-accept', run((req) => x.preAcceptStage(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/stage-pre-decline', run((req) => x.preDeclineStage(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/employee-accept', run((req) => x.acceptCurrentStage(getDB(), actor(req), id(req))));
router.post('/tickets/:id/employee-decline', run((req) => x.declineCurrentStage(getDB(), actor(req), id(req), req.body)));

// ── Work, review, final approval ──
router.post('/tickets/:id/done', run((req) => x.markStageDone(getDB(), actor(req), id(req))));
router.post('/tickets/:id/review', run((req) => x.reviewTicket(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/admin-approve', run((req) => x.adminApproveTicket(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/admin-decline', run((req) => x.adminDeclineTicket(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/admin-send-client', run((req) => x.adminSendToClient(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/client-reject', run((req) => x.clientRejectTicket(getDB(), actor(req), id(req), req.body)));
router.post('/tickets/:id/client-approve', run((req) => x.clientApproveTicket(getDB(), actor(req), id(req))));
router.post('/tickets/:id/close', run((req) => x.closeTicket(getDB(), actor(req), id(req), req.body)));

export default router;
