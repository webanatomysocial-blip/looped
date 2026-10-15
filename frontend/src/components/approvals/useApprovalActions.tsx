import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Link2, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { approvalsApi, tasksApi, xlr8Api } from '../../services/api';
import { Approval } from '../../types';
import { MiniAvatar } from '../UI/Avatar';
import Drawer from '../UI/Drawer';
import ReviewForm from './ReviewForm';

export type ReviewAction = 'approve' | 'reject' | 'request_revision';

// Everything a reviewer can do on an approval: review timer, review form, next-stage pick.
// Shared by the Approvals page and the task drawer so both behave the same.
// `inlineReview`: the review form is rendered by the card itself instead of a side drawer.
export function useApprovalActions({ onChanged, inlineReview = false }: { onChanged: () => void; inlineReview?: boolean }) {
  const { user } = useAuth();

  // Review form state
  const [reviewModal, setReviewModal]   = useState<Approval | null>(null);
  const [linksPopup, setLinksPopup]     = useState<{ title: string; items: any[] | null } | null>(null);
  const [action, setAction]             = useState<ReviewAction>('approve');
  const [returnIdx, setReturnIdx]       = useState<number | null>(null);
  const [notes, setNotes]               = useState('');
  const [submitting, setSubmitting]     = useState(false);
  // Next-stage assignment after approval
  const [assignStage, setAssignStage]   = useState<{ taskId: number; stageName: string; eligible: any[] } | null>(null);
  // Bumped after each review so open cards refetch their detail
  const [reviewedAt, setReviewedAt]     = useState(0);

  // Timer state: taskId → { seconds, running }
  const [timers, setTimers] = useState<Record<number, { seconds: number; running: boolean }>>({});
  const intervals = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  useEffect(() => () => { Object.values(intervals.current).forEach(clearInterval); }, []);

  const tick = (taskId: number) => {
    if (intervals.current[taskId]) clearInterval(intervals.current[taskId]);
    intervals.current[taskId] = setInterval(() => {
      setTimers((prev) => ({ ...prev, [taskId]: { ...prev[taskId], seconds: (prev[taskId]?.seconds ?? 0) + 1 } }));
    }, 1000);
  };

  // Seed timer state from the server's approvals list
  const seedTimers = (list: Approval[]) => {
    const init: Record<number, { seconds: number; running: boolean }> = {};
    for (const a of list as any[]) {
      init[a.task_id] = { seconds: a.tracked_seconds_today ?? 0, running: a.timer_running ?? false };
      if (a.timer_running) tick(a.task_id); // Resume ticking for already-running timers
    }
    setTimers(init);
  };

  const fmtSeconds = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const startReviewTimer = async (taskId: number, e: React.MouseEvent, title?: string) => {
    e.stopPropagation();
    // Open the attachments popup immediately on every Start/Resume, then fill it in
    setLinksPopup({ title: title || 'Attachments', items: null });
    tasksApi.getDeliverables(taskId)
      .then((r) => setLinksPopup((p) => p && { ...p, items: r.data || [] }))
      .catch(() => setLinksPopup((p) => p && { ...p, items: [] }));
    try {
      await tasksApi.timer(taskId, 'start');
      setTimers((prev) => ({ ...prev, [taskId]: { seconds: prev[taskId]?.seconds ?? 0, running: true } }));
      tick(taskId);
    } catch { setLinksPopup(null); alert('Failed to start timer'); }
  };

  const pauseReviewTimer = async (taskId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await tasksApi.timer(taskId, 'pause');
      clearInterval(intervals.current[taskId]);
      delete intervals.current[taskId];
      setTimers((prev) => ({ ...prev, [taskId]: { ...prev[taskId], running: false } }));
    } catch { alert('Failed to pause timer'); }
  };

  const markComplete = async (a: Approval) => {
    if (!confirm(`Mark "${a.title}" as completed?`)) return;
    try { await approvalsApi.markComplete(a.id); onChanged(); }
    catch (err: any) { alert(err.response?.data?.error || 'Error'); }
  };

  const openReview = (a: Approval, e: React.MouseEvent) => {
    e.stopPropagation();
    setReviewModal(a);
    setAction('approve');
    setNotes('');
  };

  const submitReview = async (skipType?: 'skip_admin' | 'send_client') => {
    if (!reviewModal) return;
    if (action !== 'approve' && !notes.trim()) { alert('Please add a reason'); return; }
    setSubmitting(true);
    try {
      if (reviewModal.workflow_type === 'xlr8') {
        const tid = reviewModal.task_id;
        const st = (reviewModal as any).xlr8_status ?? reviewModal.status;
        let res: any = null;
        if (st === 'pending_admin') {
          if (action === 'reject') {
            await xlr8Api.adminDecline(tid, notes || undefined, returnIdx);
          } else if (skipType === 'send_client') {
            // "Skip Client": approve and complete without client review
            await xlr8Api.adminApprove(tid, notes || undefined, true);
          } else {
            await xlr8Api.adminApprove(tid, notes || undefined);
          }
        } else if (st === 'pending_client') {
          await (user?.role === 'client' ? xlr8Api.clientApprove(tid) : xlr8Api.closeTicket(tid));
        } else {
          // pending_manager — manager review; skip_admin=true bypasses admin stage
          const xlr8Action = action === 'approve' ? 'approve' : 'decline';
          res = await xlr8Api.reviewTicket(tid, xlr8Action, notes, skipType === 'skip_admin', xlr8Action === 'decline' ? returnIdx : undefined);
        }
        setReviewModal(null);
        setReviewedAt(Date.now());
        // If more stages remain, fetch eligible workers and show assignment picker
        if (action === 'approve' && res?.data?.next === 'pending_manager' && res?.data?.stage && res?.data?.stage?.type !== 'manager') {
          const eligible = await xlr8Api.acceptTicket(tid);
          if (!eligible.data.auto_assigned) {
            setAssignStage({ taskId: tid, stageName: res.data.stage.category_name, eligible: eligible.data.eligible });
          }
        }
      } else {
        await approvalsApi.review(reviewModal.id, action, notes);
        setReviewModal(null);
        setReviewedAt(Date.now());
      }
      onChanged();
    } catch (err: any) { alert(err.response?.data?.error || 'Error'); }
    finally { setSubmitting(false); }
  };

  const form = { reviewModal, setReviewModal, action, setAction, returnIdx, setReturnIdx, notes, setNotes, submitting, submitReview };

  // Popups shared by every surface; render once next to the cards
  const overlays = (
    <>
      {reviewModal && !inlineReview && (
        <Drawer label="Review Approval" title={reviewModal.title} onClose={() => setReviewModal(null)}>
          <ReviewForm {...form} />
        </Drawer>
      )}

      {/* Assign next stage worker modal */}
      {assignStage && (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={(e) => { if (e.target === e.currentTarget) setAssignStage(null); }}>
          <div className="modal" style={{ width: '100%', maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">Assign {assignStage.stageName}</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Stage approved — pick who does the {assignStage.stageName} work</p>
            </div>
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {assignStage.eligible.map((e: any) => (
                <button key={e.id} className="btn-ghost" style={{ justifyContent: 'flex-start', gap: 10 }}
                  onClick={async () => {
                    await xlr8Api.assignTicket(assignStage.taskId, e.id);
                    setAssignStage(null);
                    onChanged();
                  }}>
                  <MiniAvatar name={e.name} color={e.avatar_color} avatarUrl={e.avatar_url} size={30} fontSize={11} />
                  {e.name}
                </button>
              ))}
              {assignStage.eligible.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No {assignStage.stageName} employees found in your pod.</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setAssignStage(null)}>Skip for now</button>
            </div>
          </div>
        </div>
      )}

      {linksPopup && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,26,0.4)' }} onClick={() => setLinksPopup(null)} />
          <div role="dialog" aria-label="Submitted attachments" style={{ position: 'relative', background: 'var(--surface, #fff)', borderRadius: 14, width: '92%', maxWidth: 440, padding: '18px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-muted)' }}>Submitted attachments</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '2px 0 12px' }}>{linksPopup.title}</div>
            {linksPopup.items === null && <p style={{ fontSize: 13, color: 'var(--ink-muted)', margin: 0 }}>Loading attachments…</p>}
            {linksPopup.items?.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-muted)', margin: 0 }}>Nothing was attached to this work. Check the description and stage flow instead.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
              {(linksPopup.items ?? []).map((d: any) => (
                <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--ink)', textDecoration: 'none', fontSize: 13 }}>
                  {d.type === 'file' ? <Paperclip size={13} color="var(--ink-muted)" /> : <Link2 size={13} color="var(--ink-muted)" />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.url}</span>
                  <ExternalLink size={12} color="var(--ink-muted)" />
                </a>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: '10px 0 0' }}>Your review timer is running.</p>
            <button className="btn-primary" style={{ marginTop: 12, width: '100%' ,textAlign:"center"}} onClick={() => setLinksPopup(null)}>Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );

  return {
    user, timers, seedTimers, fmtSeconds, startReviewTimer, pauseReviewTimer,
    markComplete, openReview, form, reviewedAt, inlineReview, overlays,
  };
}

export type ApprovalActions = ReturnType<typeof useApprovalActions>;
