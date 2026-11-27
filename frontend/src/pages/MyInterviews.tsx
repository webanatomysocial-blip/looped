// My Interviews: final interviews this person is taking. They open the resume, then rate the candidate and
// recommend approve or reject. The admin makes the final decision.
import { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import '../css/admin/UserManagement.css';
import { myInterviewsApi } from '../services/api';
import { fmtDate } from '../utils/date';

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

function Feedback({ iv, onSaved }: { iv: any; onSaved: () => void }) {
  const [rating, setRating] = useState<number>(iv.feedback?.rating ?? 0);
  const [rec, setRec] = useState<'approve' | 'reject' | ''>(iv.feedback?.recommendation ?? '');
  const [notes, setNotes] = useState<string>(iv.feedback?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async () => {
    setBusy(true); setMsg('');
    try { await myInterviewsApi.feedback(iv.schedule_id, { rating, recommendation: rec as any, notes }); setMsg('Saved. You can change it until the admin decides.'); onSaved(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Could not save'); }
    finally { setBusy(false); }
  };
  if (iv.decision) return null;
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--sand-border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{iv.feedback ? 'Your feedback (you can update it)' : 'Your feedback'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }} role="radiogroup" aria-label="Rating out of 5">
        <span style={{ fontSize: 12, color: 'var(--ink-muted)', width: 90 }}>Performance</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} onClick={() => setRating(n)}
            style={{ fontSize: 20, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', color: n <= rating ? '#f59e0b' : '#cbd5e1', padding: 2 }}>★</button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{rating ? `${rating}/5` : 'Tap to rate'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)', width: 90 }}>Recommend</span>
        {(['approve', 'reject'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setRec(k)}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
              border: `1.5px solid ${rec === k ? (k === 'approve' ? '#16a34a' : '#dc2626') : 'var(--sand-border)'}`,
              background: rec === k ? (k === 'approve' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.08)') : 'transparent',
              color: rec === k ? (k === 'approve' ? '#15803d' : '#b91c1c') : 'var(--ink-muted)' }}>
            {k === 'approve' ? 'Approve' : 'Reject'}
          </button>
        ))}
      </div>
      <textarea className="form-input" rows={3} placeholder="How did the interview go? Strengths, concerns, anything the admin should know." value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" disabled={busy || !rating || !rec || !notes.trim()} onClick={save}>{iv.feedback ? 'Update feedback' : 'Submit feedback'}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{msg}</span>}
      </div>
    </div>
  );
}

export default function MyInterviews() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => myInterviewsApi.list().then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  // Opened from a WhatsApp or email link: scroll to that interview
  useEffect(() => { if (rows && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }); }, [rows]);
  const openResume = async (iv: any) => {
    const w = window.open('', '_blank');
    try { const r = await myInterviewsApi.resumeLink(iv.schedule_id); if (w) w.location.href = r.data.url; }
    catch (e: any) { w?.close(); alert(e?.response?.data?.error || 'Could not open the resume'); }
  };
  const upcoming = (rows ?? []).filter((r) => !r.decision && r.date >= today && r.interview_status === 'scheduled').reverse();
  const rest = (rows ?? []).filter((r) => !upcoming.includes(r));
  const card = (iv: any) => (
    <div key={iv.schedule_id} id={`iv-${iv.schedule_id}`} className="audit-row" style={location.hash === `#iv-${iv.schedule_id}` ? { boxShadow: '0 0 0 2px #1a5fa0' } : undefined}>
      <div className="audit-head" style={{ flexWrap: 'wrap' }}>
        <b>{iv.candidate}</b>
        <span>· {iv.job}</span>
        <span className="audit-meta">Ref {iv.ref}</span>
        {iv.decision ? <span className="audit-tag" style={{ color: iv.decision === 'Shortlisted' ? '#257a50' : '#b52028', background: iv.decision === 'Shortlisted' ? '#257a5018' : '#b5202818' }}>Final decision: {iv.decision}</span>
          : iv.feedback ? <span className="audit-tag" style={{ color: '#1a5fa0', background: '#1a5fa018' }}>Feedback sent</span>
          : <span className="audit-tag" style={{ color: '#b45309', background: '#b4530918' }}>Feedback needed</span>}
      </div>
      <div className="audit-line">
        {fmtDate(iv.date)} · {iv.start_time}–{iv.end_time} (IST) · {iv.type === 'online' ? 'Online' : 'Walk-in'}
        {iv.experience_years != null && ` · ${iv.experience_years} yrs relevant experience`}
      </div>
      <div className="audit-line">
        {iv.type === 'online' ? <a href={iv.meeting_url} target="_blank" rel="noreferrer">Join the meeting</a> : `${iv.location ?? ''} ${iv.address ?? ''}`}
        {iv.has_resume && <> · <button type="button" onClick={() => openResume(iv)} style={{ background: 'none', border: 'none', padding: 0, color: '#1a5fa0', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>Open resume</button></>}
      </div>
      {iv.decision && iv.feedback && <div className="audit-line">Your feedback: {iv.feedback.rating}/5, recommended {iv.feedback.recommendation}.</div>}
      <Feedback iv={iv} onSaved={load} />
    </div>
  );
  return (
    <Layout>
      <div className="page-wrap">
        <div className="users-top">
          <div>
            <h2 className="page-title">My Interviews</h2>
            <p className="page-subtitle">Candidates you're interviewing. After each interview, rate the candidate and recommend approve or reject. The admin makes the final decision.</p>
          </div>
        </div>
        {rows === null ? <p className="page-subtitle">Loading…</p> : rows.length === 0 ? <p className="page-subtitle">You have no interviews assigned.</p> : (
          <>
            {upcoming.length > 0 && <><h3 style={{ fontSize: 14, margin: '14px 0 8px' }}>Upcoming</h3><div className="audit-list">{upcoming.map(card)}</div></>}
            {rest.length > 0 && <><h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Past and decided</h3><div className="audit-list">{rest.map(card)}</div></>}
          </>
        )}
      </div>
    </Layout>
  );
}
