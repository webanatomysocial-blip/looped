// My Interviews: the final interviews this person takes. To do → evaluate (rating, recommendation, notes)
// or, if it couldn't happen, report why. The admin makes the final decision.
import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout/Layout';
import '../css/admin/UserManagement.css';
import '../css/pages/MyInterviews.css';
import { myInterviewsApi, recruitmentApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type Tab = 'todo' | 'upcoming' | 'done';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const startOf = (iv: any) => new Date(`${iv.date}T${iv.start_time}:00+05:30`).getTime();   // interview times are IST
const responded = (iv: any) => !!(iv.feedback || iv.issue || iv.team_issue);
// Admins' interviews are done only once decided (their decision is final); others' once they responded
const tabOf = (iv: any, now: number, admin = false): Tab => (iv.decision || (!admin && responded(iv)) ? 'done' : startOf(iv) > now ? 'upcoming' : 'todo');
const RATING = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent'];

function Status({ iv, tab, admin }: { iv: any; tab: Tab; admin: boolean }) {
  if (iv.decision) return <span className={`mi-pill ${iv.decision === 'Shortlisted' ? 'mi-pill--done' : 'mi-pill--muted'}`}>{iv.decision}</span>;
  if (admin && tab === 'todo') return <span className="mi-pill mi-pill--due">{iv.feedback ? 'Decision pending' : 'Evaluate and decide'}</span>;
  if (iv.feedback) return <span className="mi-pill mi-pill--done">Evaluated</span>;
  if (iv.issue || iv.team_issue) return <span className="mi-pill mi-pill--warn">Problem reported</span>;
  if (tab === 'todo') return <span className="mi-pill mi-pill--due">Evaluation due</span>;
  const days = Math.round((new Date(iv.date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  return <span className="mi-pill mi-pill--soon">{days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>;
}

function Evaluate({ iv, onDone, admin }: { iv: any; onDone: () => void; admin: boolean }) {
  const [rating, setRating] = useState<number>(iv.feedback?.rating ?? 0);
  const [rec, setRec] = useState<'approve' | 'reject' | ''>(iv.feedback?.recommendation ?? '');
  const [notes, setNotes] = useState<string>(iv.feedback?.notes ?? '');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  // decide: an admin's Shortlist / Reject is applied straight away as the final decision
  const save = async (decide = false) => {
    setBusy(true); setMsg('');
    try {
      await myInterviewsApi.feedback(iv.schedule_id, { rating, recommendation: rec as any, notes });
      if (decide) await recruitmentApi.decide(iv.application_id, rec === 'approve' ? 'approve' : 'reject', notes);
      onDone();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Could not save'); onDone(); } finally { setBusy(false); }
  };
  return (<>
    <div className="mi-field">
      <span className="mi-label">How did the candidate do?</span>
      <div className="mi-stars" role="radiogroup" aria-label="Rating out of 5">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} className={`mi-star ${n <= rating ? 'mi-star--on' : ''}`} onClick={() => setRating(n)}>★</button>)}
        <span className="mi-star-text">{rating ? `${rating}/5 · ${RATING[rating]}` : 'Tap a star'}</span>
      </div>
    </div>
    <div className="mi-field">
      <span className="mi-label">{admin ? 'Your decision (final)' : 'Your recommendation'}</span>
      <div className="mi-seg">
        <button type="button" className={rec === 'approve' ? 'mi-seg--yes' : ''} onClick={() => setRec('approve')}>{admin ? 'Shortlist' : 'Approve'}</button>
        <button type="button" className={rec === 'reject' ? 'mi-seg--no' : ''} onClick={() => setRec('reject')}>Reject</button>
      </div>
    </div>
    <div className="mi-field">
      <label className="mi-label" htmlFor={`n-${iv.schedule_id}`}>{admin ? 'Notes (kept with the decision; never sent to the candidate)' : 'Notes for the admin'}</label>
      <textarea id={`n-${iv.schedule_id}`} className="form-input" rows={3} placeholder="Strengths, concerns, anything they should know" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </div>
    <div className="mi-actions">
      {admin ? (<>
        <button type="button" className="mi-btn mi-btn--primary" disabled={busy || !rating || !rec || !notes.trim()} onClick={() => save(true)}>{rec === 'reject' ? 'Reject candidate' : 'Shortlist candidate'}</button>
        <button type="button" className="mi-btn" disabled={busy || !rating || !rec || !notes.trim()} onClick={() => save(false)}>Save, decide later</button>
      </>) : <button type="button" className="mi-btn mi-btn--primary" disabled={busy || !rating || !rec || !notes.trim()} onClick={() => save()}>{iv.feedback ? 'Save changes' : 'Submit evaluation'}</button>}
      {msg ? <span className="mi-msg mi-msg--bad">{msg}</span> : (!rating || !rec || !notes.trim()) && <span className="mi-msg">Rating, recommendation and notes are needed</span>}
    </div>
  </>);
}

function Problem({ iv, reasons, onDone }: { iv: any; reasons: Record<string, string>; onDone: () => void }) {
  const [reason, setReason] = useState<string>(iv.issue?.reason ?? '');
  const [note, setNote] = useState<string>(iv.issue?.note ?? '');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const send = async () => {
    setBusy(true); setMsg('');
    try { await myInterviewsApi.reportIssue(iv.schedule_id, { reason, note }); onDone(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Could not send'); } finally { setBusy(false); }
  };
  return (<>
    <div className="mi-field">
      <label className="mi-label" htmlFor={`r-${iv.schedule_id}`}>What happened?</label>
      <select id={`r-${iv.schedule_id}`} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">Choose a reason…</option>
        {Object.entries(reasons).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </div>
    <div className="mi-field">
      <label className="mi-label" htmlFor={`p-${iv.schedule_id}`}>Details {reason === 'other' ? '(required)' : '(optional)'}</label>
      <textarea id={`p-${iv.schedule_id}`} className="form-input" rows={2} placeholder="e.g. waited 20 minutes, phone switched off" value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
    <div className="mi-actions">
      <button type="button" className="mi-btn mi-btn--primary" disabled={busy || !reason || (reason === 'other' && !note.trim())} onClick={send}>Send to admin</button>
      {msg && <span className="mi-msg mi-msg--bad">{msg}</span>}
    </div>
  </>);
}

function Card({ iv, tab, reasons, focus, onChanged, admin }: { iv: any; tab: Tab; reasons: Record<string, string>; focus: boolean; onChanged: () => void; admin: boolean }) {
  const [mode, setMode] = useState<'' | 'evaluate' | 'problem'>(focus && !iv.decision && !responded(iv) && tab !== 'upcoming' ? 'evaluate' : '');
  const d = new Date(`${iv.date}T00:00:00`);
  const openResume = async () => {
    const w = window.open('', '_blank');
    try { const r = await myInterviewsApi.resumeLink(iv.schedule_id); if (w) w.location.href = r.data.url; }
    catch (e: any) { w?.close(); alert(e?.response?.data?.error || 'Could not open the resume'); }
  };
  const done = () => { setMode(''); onChanged(); };
  const canAct = !iv.decision;
  return (
    <div id={`iv-${iv.schedule_id}`} className={`mi-card ${focus ? 'mi-card--focus' : ''}`}>
      <div className="mi-row">
        <div className="mi-date"><div className="mi-date__d">{d.getDate()}</div><div className="mi-date__m">{MONTHS[d.getMonth()]}</div></div>
        <div className="mi-main">
          <div className="mi-name">{iv.candidate}</div>
          <div className="mi-sub">
            <span>{iv.job}</span><span>{iv.start_time}–{iv.end_time}</span><span>{iv.type === 'online' ? 'Online' : 'Walk-in'}</span>
            {iv.experience_years != null && <span>{iv.experience_years} yrs exp.</span>}<span>{iv.ref}</span>
          </div>
        </div>
        <div className="mi-side">
          <Status iv={iv} tab={tab} admin={admin} />
          {!iv.decision && iv.type === 'online' && iv.meeting_url && tab !== 'done' && <a className="mi-btn" href={iv.meeting_url} target="_blank" rel="noreferrer">Join meeting</a>}
          {iv.has_resume && <button type="button" className="mi-btn" onClick={openResume}>Resume</button>}
          {admin && <a className="mi-btn" href={`/recruitment?app=${iv.application_id}`}>Open in Recruitment</a>}
          {canAct && mode === '' && (tab === 'upcoming'
            ? <button type="button" className="mi-btn" onClick={() => setMode('problem')}>Report a problem</button>
            : <button type="button" className={`mi-btn ${tab === 'todo' ? 'mi-btn--primary' : ''}`} onClick={() => setMode('evaluate')}>{admin ? (iv.feedback ? 'Decide' : 'Evaluate and decide') : iv.feedback ? 'Edit evaluation' : iv.issue || iv.team_issue ? 'Evaluate anyway' : 'Evaluate'}</button>)}
          {mode !== '' && <button type="button" className="mi-btn" onClick={() => setMode('')}>Close</button>}
        </div>
      </div>
      {iv.type === 'walkin' && tab !== 'done' && (iv.location || iv.address) && <div className="mi-summary">Venue: {iv.location} {iv.address}</div>}
      {iv.feedback && mode === '' && <div className="mi-summary">Your evaluation: {'★'.repeat(iv.feedback.rating)}{'☆'.repeat(5 - iv.feedback.rating)} · recommended <b>{iv.feedback.recommendation}</b></div>}
      {iv.issue && mode === '' && <div className="mi-note">You reported: <b>{iv.issue.label}</b>{iv.issue.note ? ` — “${iv.issue.note}”` : ''}</div>}
      {admin && iv.team && (iv.team.feedback.length > 0 || iv.team.issues.length > 0) && (
        <div className="mi-summary">
          <div className="mi-label" style={{ marginBottom: 4 }}>Other interviewers</div>
          {iv.team.feedback.map((f: any, k: number) => <div key={`f${k}`}>{f.by}: {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)} · recommends <b>{f.recommendation}</b>{f.notes ? ` — “${f.notes}”` : ''}</div>)}
          {iv.team.issues.map((i: any, k: number) => <div key={`i${k}`}>{i.by} reported: <b>{i.label}</b>{i.note ? ` — “${i.note}”` : ''}</div>)}
        </div>
      )}
      {admin && iv.team && iv.team.feedback.length === 0 && iv.team.issues.length === 0 && tab === 'todo' && <div className="mi-summary" style={{ color: 'var(--ink-muted)' }}>No feedback from the other interviewers yet.</div>}
      {iv.team_issue && !iv.issue && mode === '' && <div className="mi-note"><b>{iv.team_issue.by}</b> reported: <b>{iv.team_issue.label}</b>{iv.team_issue.note ? ` — “${iv.team_issue.note}”` : ''}. Nothing needed from you unless the interview goes ahead.</div>}
      {mode !== '' && (
        <div className="mi-panel">
          {mode === 'evaluate' ? <Evaluate iv={iv} onDone={done} admin={admin} /> : <Problem iv={iv} reasons={reasons} onDone={done} />}
          {admin && mode === 'problem' && <div className="mi-msg">As an admin you can also change the time or cancel the interview in <a href={`/recruitment?app=${iv.application_id}`}>Recruitment</a>.</div>}
          <div>
            {mode === 'evaluate'
              ? <button type="button" className="mi-link" onClick={() => setMode('problem')}>Couldn't take the interview? Report a problem</button>
              : tab !== 'upcoming' && <button type="button" className="mi-link" onClick={() => setMode('evaluate')}>The interview happened — evaluate instead</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyInterviews() {
  const admin = useAuth().user?.role === 'admin';
  const [rows, setRows] = useState<any[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab | null>(null);
  const focusId = typeof window !== 'undefined' && window.location.hash.startsWith('#iv-') ? Number(window.location.hash.slice(4)) : null;
  const load = () => myInterviewsApi.list().then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); myInterviewsApi.issueReasons().then((r) => setReasons(r.data)).catch(() => {}); }, []);

  const now = Date.now();
  const groups = useMemo(() => {
    const g: Record<Tab, any[]> = { todo: [], upcoming: [], done: [] };
    for (const iv of rows ?? []) g[tabOf(iv, now, admin)].push(iv);
    g.upcoming.sort((a, b) => startOf(a) - startOf(b));
    return g;
  }, [rows]);
  // Start where the work is: the linked interview's tab, else To do, else Upcoming
  useEffect(() => {
    if (!rows || tab) return;
    const linked = focusId ? rows.find((r) => Number(r.schedule_id) === focusId) : null;
    setTab(linked ? tabOf(linked, now, admin) : groups.todo.length ? 'todo' : groups.upcoming.length ? 'upcoming' : 'done');
  }, [rows]);
  useEffect(() => { if (rows && focusId) setTimeout(() => document.getElementById(`iv-${focusId}`)?.scrollIntoView({ block: 'center' }), 50); }, [rows, tab]);

  const TABS: [Tab, string][] = [['todo', 'To do'], ['upcoming', 'Upcoming'], ['done', 'Done']];
  const empty: Record<Tab, string> = { todo: admin ? 'Nothing to decide right now.' : 'Nothing to evaluate right now.', upcoming: 'No upcoming interviews.', done: 'No finished interviews yet.' };
  const current = tab ?? 'todo';
  return (
    <Layout>
      <div className="page-wrap">
        <h2 className="page-title">My Interviews</h2>
        <p className="page-subtitle">{admin ? 'Interviews you are taking. As an admin, your Shortlist or Reject is the final decision.' : 'After each interview, evaluate the candidate. The admin makes the final decision.'}</p>
        {rows === null ? <p className="page-subtitle">Loading…</p> : (<>
          <div className="mi-tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={current === k} className={`mi-tab ${current === k ? 'mi-tab--on' : ''} ${k === 'todo' && groups.todo.length ? 'mi-tab--due' : ''}`} onClick={() => setTab(k)}>
                {label}<b>{groups[k].length}</b>
              </button>
            ))}
          </div>
          <div className="mi-list">
            {groups[current].length === 0 ? <div className="mi-empty">{empty[current]}</div>
              : groups[current].map((iv) => <Card key={iv.schedule_id} iv={iv} tab={current} reasons={reasons} focus={focusId === Number(iv.schedule_id)} onChanged={load} admin={admin} />)}
          </div>
        </>)}
      </div>
    </Layout>
  );
}
