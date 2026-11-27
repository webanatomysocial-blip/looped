// "My Interviews": any staff member assigned to a candidate's final interview sees it here and sends their feedback
import { Router, Response } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import { getDB } from '../db';
import { ServiceError } from '../services/access';
import * as F from '../services/interviewFeedback';

const router = Router();
router.use(authenticate, requireRoles('admin', 'manager', 'employee'));
const me = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role, name: (req.user as any).name ?? '' });
const run = (fn: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try { res.json(await fn(req)); }
  catch (e: any) { if (e instanceof ServiceError) res.status(e.status).json({ error: e.message }); else { console.error('[my-interviews]', e); res.status(500).json({ error: 'Could not complete this' }); } }
};
router.get('/', run((req) => F.myInterviews(getDB(), me(req))));
router.get('/:scheduleId/resume-link', run((req) => F.interviewerResumeLink(getDB(), me(req), Number(req.params.scheduleId))));
router.post('/:scheduleId/feedback', run((req) => F.submitFeedback(getDB(), me(req), Number(req.params.scheduleId), req.body)));
export default router;
