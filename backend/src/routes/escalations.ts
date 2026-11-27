import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import { ServiceError } from '../services/access';
import { listEscalations, escalationCounts, reviewEscalation } from '../services/escalations';

const router = Router();
router.use(authenticate);
const run = (fn: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try { res.json(await fn(req)); }
  catch (e: any) { if (e instanceof ServiceError) res.status(e.status).json({ error: e.message }); else { console.error('[escalations]', e); res.status(500).json({ error: 'Could not complete this' }); } }
};
router.get('/', run((req) => listEscalations(getDB(), req.user as any, String(req.query.status ?? ''))));
router.get('/counts', run((req) => escalationCounts(getDB(), req.user as any)));
router.post('/:id/review', run((req) => reviewEscalation(getDB(), req.user as any, Number(req.params.id), req.body?.decision, req.body?.note)));
export default router;
