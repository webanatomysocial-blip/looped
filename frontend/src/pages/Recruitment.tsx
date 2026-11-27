// Recruitment dashboard for admins and managers: overview, job openings, applications (review, interview, evaluation,
// scheduling), the common HR question bank and settings. What each person may approve is decided by the server;
// the buttons shown follow its answer ("can").
import { fmtDay } from './Careers';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout/Layout';
import Modal from '../components/UI/Modal';
import Drawer from '../components/UI/Drawer';
import { recruitmentApi as api } from '../services/api';
import { slugify } from './Careers';
import { notify, ask, DialogHost } from '../components/UI/dialogs';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import '../css/pages/Recruitment.css';

type Tab = 'overview' | 'openings' | 'applications' | 'questions' | 'settings';
const err = (e: any) => e?.response?.data?.error || 'Something went wrong';
// Browser-recorded WebM has no duration in its header, so the player shows 0:00 and can't seek; jumping to the end makes it work it out.
const fixDuration = (e: React.SyntheticEvent<HTMLVideoElement>) => {
  const v = e.currentTarget;
  if (v.duration !== Infinity && !Number.isNaN(v.duration)) return;
  v.currentTime = 1e9;
  v.addEventListener('timeupdate', function back() { v.removeEventListener('timeupdate', back); v.currentTime = 0; });
};
// What reviewers are told about the recording: only "Verified complete" when the server measured complete sound and video
const REC_STATUS: Record<string, [string, string]> = {
  processing: ['Processing: building and checking the recording…', 'info'], verified: ['Verified complete', 'good'],
  incomplete: ['Incomplete: see the problems below', 'warn'], failed: ['Processing failed: the uploaded recording is kept', 'bad'],
};
function RecordingStatus({ iv }: { iv: any }) {
  if (iv.recording_deleted_at) return <>Video deleted ({dt(iv.recording_deleted_at)})</>;
  if (iv.status === 'in_progress') return <span className="rec-pill rec-pill--info">{iv.recording_complete ? 'Uploading' : 'Recording in progress'}</span>;
  if (iv.status === 'paused' && !iv.processing_status) return <span className="rec-pill rec-pill--warn">Interview paused: the recording is prepared about a minute after the pause</span>;
  if (['withdrawn', 'terminated'].includes(iv.status) && !iv.processing_status) return <span className="rec-pill rec-pill--warn">Interview not completed: recording not checked</span>;
  const st = iv.processing_status ? REC_STATUS[iv.processing_status] : null;
  if (!st) return <span className="rec-pill rec-pill--warn">Not verified (recorded before checks existed)</span>;
  const secs = iv.verification?.final?.video?.seconds;
  return <><span className={`rec-pill rec-pill--${st[1]}`}>{st[0]}</span>{secs ? <span className="rec-muted"> · {Math.floor(secs / 60)}m {Math.round(secs % 60)}s</span> : null}</>;
}
function Verification({ v }: { v: any }) {
  const f = v.final; const tick = (ok: boolean) => (ok ? '✓' : '✗');
  const chunks = (v.manifest ?? []).reduce((t: any, m: any) => ({ e: t.e + m.expected, r: t.r + m.received }), { e: 0, r: 0 });
  const synced = f?.video && f?.audio && Math.abs(f.audio.seconds - f.video.seconds) <= Math.max(1.5, f.video.seconds * 0.1);
  return (
    <div className="rec-sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 10px' }}>
      <span>{tick(!!f?.video)} Video {f?.video ? `${f.video.codec}, ${f.video.seconds.toFixed(1)} s` : 'missing'} · {tick(!!f?.audio)} Sound {f?.audio ? `${f.audio.codec}, ${f.audio.seconds.toFixed(1)} s` : 'missing'} · {tick(!!synced)} In sync{v.expected_seconds ? ` · recorded ${v.expected_seconds.toFixed(1)} s` : ''}</span>
      <span>Chunks received {chunks.r} of {chunks.e} expected · {tick(!!f?.valid)} Playable file</span>
      {(v.problems ?? []).map((p: string, i: number) => <span key={i} className="rec-error">• {p}</span>)}
    </div>
  );
}
// The verified recording: one file with sound and video together. A link that ran out is renewed on the spot.
function FinalVideo({ url, refresh, video, onTime }: { url: string; refresh: () => void; video?: React.RefObject<HTMLVideoElement>; onTime?: (s: number) => void }) {
  const retried = useRef(false);
  return <video key={url} ref={video} className="rec-video" controls preload="metadata" src={url} onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)} onError={() => { if (!retried.current) { retried.current = true; refresh(); } }} />;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// The question on screen at this moment of the recording, and every question as a jump point
function QuestionTrack({ questions, now, seek }: { questions: any[]; now: number; seek: (s: number) => void }) {
  const timed = questions.filter((q) => q.video_at !== null && q.video_at !== undefined);
  if (!timed.length) return null;
  const cur = [...timed].reverse().find((q) => q.video_at <= now + 0.5) ?? timed[0];
  return (
    <div className="rec-qtrack">
      <div className="rec-qnow"><span className="rec-qnow-n">Question {cur.position + 1} of {questions.length}</span>{cur.text}</div>
      <div className="rec-qlist">
        {timed.map((q) => <button key={q.position} className={`rec-qjump ${q === cur ? 'rec-qjump--on' : ''}`} title={q.text} onClick={() => seek(q.video_at)}><b>{mmss(q.video_at)}</b> Q{q.position + 1}</button>)}
      </div>
      {timed[0].approximate && <p className="rec-muted" style={{ margin: 0 }}>The page was reloaded during this interview, so times after the reload are approximate.</p>}
    </div>
  );
}
// Evaluations as comments under the video: who wrote it, when, and the moment of the recording it is about
function EvaluationNotes({ list, videoNow, seek, save }: { list: any[]; videoNow: number | null; seek: (s: number) => void; save: (e: any) => Promise<boolean> }) {
  const blank = { comments: '', overall: '', communication: '', confidence: '' };
  const [ev, setEv] = useState<any>(blank); const [pin, setPin] = useState(true); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); if (await save({ ...ev, video_at: pin && videoNow !== null ? videoNow : null })) setEv(blank); setBusy(false); };
  return (
    <div className="rec-notes">
      <h4>Evaluation comments ({list.length})</h4>
      {list.length === 0 && <p className="rec-muted">No evaluations yet.</p>}
      {[...list].reverse().map((e) => (
        <div key={e.id} className="rec-note">
          <div className="rec-note-head"><span className="rec-note-av">{(e.reviewer_name || '?').slice(0, 1).toUpperCase()}</span><b>{e.reviewer_name}</b><span className="rec-muted">{dt(e.created_at)}</span>
            {e.video_at !== null && e.video_at !== undefined && <button className="rec-qjump" onClick={() => seek(e.video_at)}>▶ {mmss(e.video_at)}</button>}</div>
          {(e.overall || e.communication || e.confidence) && <div className="rec-sub">{[['Overall', e.overall], ['Communication', e.communication], ['Confidence', e.confidence]].filter(([, v]) => v).map(([l, v]) => `${l} ${v}/5`).join(' · ')}</div>}
          {e.observations && <p className="careers-text">{e.observations}</p>}{e.comments && <p className="careers-text">{e.comments}</p>}
        </div>
      ))}
      <div className="rec-note-new">
        <textarea className="form-input" rows={2} placeholder="Write your evaluation…" value={ev.comments} onChange={(e) => setEv({ ...ev, comments: e.target.value })} />
        <div className="rec-actions">
          {[['overall', 'Overall'], ['communication', 'Communication'], ['confidence', 'Confidence']].map(([k, l]) => (
            <label key={k} className="rec-muted">{l} <select className="form-input rec-score" value={ev[k]} onChange={(x) => setEv({ ...ev, [k]: x.target.value })}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          ))}
          {videoNow !== null && <label className="rec-muted"><input type="checkbox" checked={pin} onChange={(x) => setPin(x.target.checked)} /> at {mmss(videoNow)} in the video</label>}
          <button className="btn-primary" disabled={busy || (!ev.comments.trim() && !ev.overall && !ev.communication && !ev.confidence)} onClick={submit}>{busy ? 'Saving…' : 'Post'}</button>
        </div>
      </div>
    </div>
  );
}
// The recording can come in parts (Safari records 30-second parts; a reload starts a new one): played back to back
function Recording({ parts }: { parts: { segment: number; url: string; audio_url?: string | null }[] }) {
  const [i, setI] = useState(0);
  const auto = useRef(false);
  const sound = useRef<HTMLAudioElement>(null);
  const cur = parts[Math.min(i, parts.length - 1)];
  // Apple devices: the sound was recorded on its own; it follows the video (play, pause, seek, speed)
  const follow = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget; const a = sound.current; if (!a) return;
    a.playbackRate = v.playbackRate;
    if (Math.abs(a.currentTime - v.currentTime) > 0.3) a.currentTime = v.currentTime;
    if (v.paused || v.ended) a.pause(); else void a.play().catch(() => undefined);
  };
  return (
    <div>
      <video key={cur.url} className="rec-video" controls preload="metadata" src={cur.url} autoPlay={auto.current} muted={!!cur.audio_url}
        onLoadedMetadata={fixDuration} onPlay={follow} onPause={follow} onSeeked={follow} onRateChange={follow} onTimeUpdate={(e) => { if (sound.current && Math.abs(sound.current.currentTime - e.currentTarget.currentTime) > 0.5) follow(e); }}
        onEnded={(e) => { follow(e); if (i < parts.length - 1) { auto.current = true; setI(i + 1); } }} />
      {cur.audio_url && <audio key={cur.audio_url} ref={sound} src={cur.audio_url} preload="auto" />}
      {parts.length > 1 && <div className="rec-actions" style={{ marginTop: 6 }}>
        <span className="rec-muted">Part {i + 1} of {parts.length} · plays on by itself</span>
        {parts.map((p, n) => <button key={p.segment} className={`rec-tab ${n === i ? 'rec-tab--on' : ''}`} style={{ padding: '3px 10px' }} onClick={() => { auto.current = true; setI(n); }}>{n + 1}</button>)}
      </div>}
    </div>
  );
}
const dt = (v: any) => (v ? new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v).includes('T') || String(v).includes('Z') ? v : String(v).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const tone = (s: string) => (s === 'selected' || s === 'prelim_approved' ? 'good' : s === 'rejected' || s === 'withdrawn' ? 'bad' : ['admin_review', 'interview_admin_review'].includes(s) ? 'warn' : 'info');
// The hiring steps, in order. "Needs action" collects everything someone has to do now.
const STAGES: [string, string, string][] = [
  ['action', 'Needs action', ''],
  ['new', 'New', 'applied,under_review,admin_review'],
  ['video', 'Video interview', 'prelim_pending,interview_review,interview_admin_review'],
  ['final', 'Final interview', 'prelim_approved,final_scheduled,final_completed'],
  ['selected', 'Shortlisted', 'selected'],
  ['rejected', 'Rejected', 'rejected,withdrawn'],
  ['all', 'All', ''],
];
// One plain "next step" per candidate, and whether it is someone's to do now
type Next = { text: string; tone: 'bad' | 'warn' | 'good' | 'muted' };
function nextStep(r: any, admin: boolean): Next {
  if (r.issue_open) return { text: 'Interviewer reported a problem: handle it', tone: 'bad' };
  if (r.reschedule_pending) return { text: 'Candidate asked to reschedule', tone: 'warn' };
  switch (r.status) {
    case 'applied': case 'under_review': return { text: 'Review the application', tone: 'warn' };
    case 'admin_review': return admin ? { text: 'Manager approved: your decision', tone: 'warn' } : { text: 'Waiting for the admin', tone: 'muted' };
    case 'prelim_pending': return { text: 'Waiting for the candidate to take the video interview', tone: 'muted' };
    case 'interview_review': return { text: 'Watch and review the video interview', tone: 'warn' };
    case 'interview_admin_review': return admin ? { text: 'Video approved by manager: your decision', tone: 'warn' } : { text: 'Waiting for the admin', tone: 'muted' };
    case 'prelim_approved': return { text: 'Schedule the final interview', tone: 'warn' };
    case 'final_scheduled': case 'final_completed': {
      const f = r.feedback;
      if (f && f.done.length && !f.waiting.length) return admin ? { text: 'All feedback in: make the final decision', tone: 'good' } : { text: 'All feedback in: waiting for the admin', tone: 'muted' };
      if (f && f.waiting.length) return { text: `Waiting for feedback from ${f.waiting.join(', ')}`, tone: 'muted' };
      return { text: r.status === 'final_completed' ? 'Interview done: make the final decision' : 'Final interview booked', tone: r.status === 'final_completed' && admin ? 'good' : 'muted' };
    }
    case 'selected': return { text: 'Shortlisted', tone: 'muted' };
    case 'withdrawn': return { text: 'Withdrew their application', tone: 'muted' };
    default: return { text: 'Not selected', tone: 'muted' };
  }
}

export default function Recruitment() {
  const [tab, setTab] = useState<Tab>('applications');
  const [queue, setQueue] = useState('action');
  const [departments, setDepartments] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const loadRefs = () => { api.departments().then((r) => setDepartments(r.data)).catch(() => {}); api.jobs().then((r) => setJobs(r.data)).catch(() => {}); };
  useEffect(loadRefs, []);
  const { user } = useAuth();
  // Recruitment-wide settings are admin-only (the server enforces it too)
  const tabs: [Tab, string][] = [['applications', 'Candidates'], ['openings', 'Openings'], ['questions', 'Question Bank'], ...(user?.role === 'admin' ? [['settings', 'Settings'] as [Tab, string]] : [])];
  return (
    <Layout>
      <DialogHost />
      <div className="rec-page">
        <div className="rec-head">
          <div><h1>Recruitment</h1><p>Openings, applications, interviews and hiring decisions</p></div>
          <a className="btn-secondary" href="/careers" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Open careers page ↗</a>
        </div>
        <div className="rec-tabs">{tabs.map(([k, l]) => <button key={k} className={`rec-tab ${tab === k ? 'rec-tab--on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'openings' && <Openings jobs={jobs} departments={departments} reload={loadRefs} />}
        {tab === 'applications' && <Applications jobs={jobs} departments={departments} queue={queue} setQueue={setQueue} />}
        {tab === 'questions' && <Questions departments={departments} />}
        {tab === 'settings' && <Settings />}
      </div>
    </Layout>
  );
}

function Filters({ jobs, departments, f, setF, extra }: { jobs: any[]; departments: any[]; f: any; setF: (f: any) => void; extra?: React.ReactNode }) {
  return (
    <div className="rec-filters">
      <select className="form-input" value={f.department_id ?? ''} onChange={(e) => setF({ ...f, department_id: e.target.value || undefined })}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <select className="form-input" value={f.job_id ?? ''} onChange={(e) => setF({ ...f, job_id: e.target.value || undefined })}><option value="">All openings</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
      <input className="form-input" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} title="Applied from" />
      <input className="form-input" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} title="Applied to" />
      {extra}
    </div>
  );
}

// ── Job openings ──
const EMPTY_JOB = { title: '', category_id: '', description: '', responsibilities: '', qualifications: '', skills: '', experience: '', employment_type: 'Full-time', location: '', vacancies: 1, deadline: '', status: 'draft' };
function Openings({ jobs, departments, reload }: { jobs: any[]; departments: any[]; reload: () => void }) {
  const [edit, setEdit] = useState<any>(null);
  const setStatus = async (j: any, status: string) => { try { await api.updateJob(j.id, { status }); reload(); } catch (e) { notify(err(e), 'bad'); } };
  const remove = async (j: any) => { if ((await ask({ title: `Delete "${j.title}"?`, text: 'The opening is removed. This cannot be undone.', confirm: 'Delete', danger: true })) === null) return; try { await api.deleteJob(j.id); reload(); } catch (e) { notify(err(e), 'bad'); } };
  return (<>
    <div className="rec-actions" style={{ marginBottom: 14 }}><button className="btn-primary" onClick={() => setEdit({ ...EMPTY_JOB })}>New opening</button></div>
    <div className="rec-card rec-table-wrap">
      <table className="rec-table">
        <thead><tr><th>Title</th><th>Role</th><th>Questions</th><th>Location</th><th>Vacancies</th><th>Deadline</th><th>Applications</th><th>Status</th><th /></tr></thead>
        <tbody>{jobs.length ? jobs.map((j) => (
          <tr key={j.id}>
            <td><b>{j.title}</b><div className="rec-sub">{j.employment_type} · {j.experience || 'Any experience'}{j.created_by_name ? ` · by ${j.created_by_name}` : ''}</div></td>
            <td>{j.department ?? '—'}</td>
            <td>{Number(j.question_count) ? Number(j.question_count) : <span className="rec-pill rec-pill--warn" title="Add questions for this role in the Question Bank before publishing">None yet</span>}</td>
            <td>{j.location || '—'}</td><td>{j.vacancies}</td><td style={{ whiteSpace: 'nowrap' }}>{j.deadline ? fmtDay(String(j.deadline).slice(0, 10)) : '—'}</td><td>{Number(j.applications)}</td>
            <td><span className={`rec-pill ${j.status === 'published' ? 'rec-pill--good' : j.status === 'closed' ? 'rec-pill--bad' : ''}`}>{j.status}</span></td>
            <td><div className="rec-actions rec-actions--row">
              <button className="btn-secondary" onClick={() => setEdit({ ...EMPTY_JOB, ...j, category_id: j.category_id ?? '', deadline: j.deadline ? String(j.deadline).slice(0, 10) : '' })}>Edit</button>
              {j.status !== 'published' && <button className="btn-secondary" onClick={() => setStatus(j, 'published')}>Publish</button>}
              {j.status === 'published' && <button className="btn-secondary" title="The role's own page, for LinkedIn and Instagram posts" onClick={() => { const url = `${window.location.origin}/careers/${slugify(j.title)}`; navigator.clipboard?.writeText(url).then(() => notify(`Link copied: ${url}`, 'good')).catch(() => notify(`Copy this link: ${url}`)); }}>Copy link</button>}
              {j.status === 'published' && <button className="btn-secondary" onClick={() => setStatus(j, 'closed')}>Close</button>}
              {!Number(j.applications) && <button className="rec-btn-danger" onClick={() => remove(j)}>Delete</button>}
            </div></td>
          </tr>)) : <tr><td colSpan={8} className="rec-muted">No job openings yet. Create one to start receiving applications.</td></tr>}</tbody>
      </table>
    </div>
    {edit && <JobForm job={edit} departments={departments} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
  </>);
}

function JobForm({ job, departments, onClose, onSaved }: { job: any; departments: any[]; onClose: () => void; onSaved: () => void }) {
  const isAdmin = useAuth().user?.role === 'admin';   // new Loop departments: admins only
  const [f, setF] = useState<any>(job); const [newDept, setNewDept] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError('');
    try {
      let category_id = f.category_id;
      if (category_id === 'new') {
        if (!newDept.trim()) throw { response: { data: { error: 'Enter the new department name' } } };
        category_id = (await api.addDepartment(newDept.trim())).data.id;   // added to Loop's department list, for future openings too
      }
      const body = { ...f, category_id: category_id || null, vacancies: Number(f.vacancies), deadline: f.deadline || null };
      for (const k of ['id', 'public_id', 'department', 'applications', 'created_by', 'created_by_name', 'created_at', 'updated_at']) delete body[k];
      if (job.id) await api.updateJob(job.id, body); else await api.createJob(body);
      onSaved();
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={job.id ? 'Edit job opening' : 'New job opening'} onClose={onClose} size="lg" dismissible={false}>
      <div className="rec-grid2">
        <div className="rec-field"><label>Job title *</label><input className="form-input" value={f.title} onChange={set('title')} maxLength={200} /></div>
        <div className="rec-field"><label>Department</label>
          <select className="form-input" value={f.category_id} onChange={set('category_id')}>
            <option value="">— Select —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}{isAdmin && <option value="new">Other / Create new department…</option>}
          </select>
          {f.category_id === 'new' && <input className="form-input" placeholder="New department name" value={newDept} onChange={(e) => setNewDept(e.target.value)} maxLength={100} />}
        </div>
        <div className="rec-field"><label>Employment type</label><select className="form-input" value={f.employment_type} onChange={set('employment_type')}>{['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="rec-field"><label>Experience</label><input className="form-input" placeholder="e.g. 1–3 years" value={f.experience} onChange={set('experience')} /></div>
        <div className="rec-field"><label>Work location</label><input className="form-input" value={f.location} onChange={set('location')} /></div>
        <div className="rec-field"><label>Vacancies</label><input className="form-input" type="number" min={1} value={f.vacancies} onChange={set('vacancies')} /></div>
        <div className="rec-field"><label>Application deadline</label><input className="form-input" type="date" value={f.deadline} onChange={set('deadline')} /></div>
        <div className="rec-field"><label>Status</label><select className="form-input" value={f.status} onChange={set('status')}><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></div>
        {[['description', 'Job description'], ['responsibilities', 'Responsibilities'], ['qualifications', 'Required qualifications'], ['skills', 'Required skills']].map(([k, l]) => (
          <div key={k} className="rec-field rec-field--full"><label>{l}</label><textarea className="form-input" rows={3} value={f[k] ?? ''} onChange={set(k)} /></div>
        ))}
      </div>
      {error && <p className="rec-error">{error}</p>}
      <div className="rec-actions rec-sticky-actions"><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button><button className="btn-secondary" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

// ── Candidates ──
function Applications({ jobs, departments, queue, setQueue }: { jobs: any[]; departments: any[]; queue: string; setQueue: (q: string) => void }) {
  const [f, setF] = useState<any>({}); const [search, setSearch] = useState(''); const [more, setMore] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  // ?app=ID (e.g. from My Interviews) opens that candidate straight away
  const [open, setOpen] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('app')) || null);
  const isAdmin = useAuth().user?.role === 'admin';
  const [picked, setPicked] = useState<Set<number>>(new Set()); const [deleting, setDeleting] = useState(false);
  const [counts, setCounts] = useState<any>(null);
  const stage = STAGES.find(([k]) => k === queue) ?? STAGES[0];
  const load = () => {
    api.overview().then((r) => setCounts(r.data)).catch(() => {});
    const scope = stage[0] === 'action' ? { needs: 'action' } : stage[2] ? { status: stage[2] } : {};
    return api.applications({ ...f, ...scope, search: search || undefined }).then((r) => { setRows(r.data); setPicked(new Set()); }).catch(() => setRows([]));
  };
  const countOf = (k: string, statuses: string) => (!counts ? null : k === 'action' ? Number(counts.needs_action ?? 0) : k === 'all' ? Number(counts.applications_total ?? 0)
    : statuses.split(',').reduce((n, x) => n + Number(counts.by_status?.[x] ?? 0), 0));
  const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
  const pickedBytes = (rows ?? []).filter((r) => picked.has(r.id)).reduce((n, r) => n + Number(r.storage_bytes || 0), 0);
  const toggle = (id: number) => setPicked((p) => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const allOn = !!rows?.length && rows.every((r) => picked.has(r.id));
  // Removes the applicants completely: application, history, scores, interview, resume and recording. Not undoable.
  const removePicked = async () => {
    const n = picked.size;
    if ((await ask({ title: `Delete ${n} applicant${n > 1 ? 's' : ''}?`, text: `Their application, interview, resume and recording (${mb(pickedBytes)}) are deleted for good. Type DELETE to confirm.`, input: { placeholder: 'DELETE', match: 'DELETE' }, confirm: 'Delete', danger: true })) === null) return;
    setDeleting(true);
    try {
      const r = await api.deleteCandidates([...picked]);
      notify(`Deleted ${r.data.deleted} applicant${r.data.deleted === 1 ? '' : 's'}, freed ${mb(r.data.freed_bytes)}.${r.data.failed.length ? ` ${r.data.failed.length} could not be deleted.` : ''}`, r.data.failed.length ? 'bad' : 'good');
    } catch (e) { notify(err(e), 'bad'); } finally { setDeleting(false); load(); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [JSON.stringify(f), queue, search]);
  const flagged = (r: any) => r.interview_paused || ['integrity_review_required', 'suspicious', 'confirmed', 'monitoring'].includes(r.integrity_status);
  const filtersOn = !!(f.department_id || f.from || f.to);
  return (<>
    <div className="rec-stages" role="tablist">
      {STAGES.map(([k, label, st]) => {
        const n = countOf(k, st);
        return (
          <button key={k} role="tab" aria-selected={queue === k} className={`rec-stage ${queue === k ? 'rec-stage--on' : ''} ${k === 'action' && n ? 'rec-stage--due' : ''}`} onClick={() => setQueue(k)}>
            {label}{n !== null && <b>{n}</b>}
          </button>
        );
      })}
    </div>
    <div className="rec-bar">
      <input className="form-input rec-bar__search" placeholder="Search name, email or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select className="form-input" value={f.job_id ?? ''} onChange={(e) => setF({ ...f, job_id: e.target.value || undefined })}><option value="">All openings</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
      <button type="button" className={`btn-secondary ${filtersOn ? 'rec-bar__on' : ''}`} onClick={() => setMore(!more)}>{more ? 'Fewer filters' : filtersOn ? 'More filters (on)' : 'More filters'}</button>
    </div>
    {more && (
      <div className="rec-bar">
        <select className="form-input" value={f.department_id ?? ''} onChange={(e) => setF({ ...f, department_id: e.target.value || undefined })}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <label className="rec-bar__date">Applied from <input className="form-input" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} /></label>
        <label className="rec-bar__date">to <input className="form-input" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} /></label>
        {filtersOn && <button type="button" className="btn-secondary" onClick={() => setF({ job_id: f.job_id })}>Clear</button>}
      </div>
    )}
    {isAdmin && picked.size > 0 && (
      <div className="rec-selbar">
        <span>{picked.size} selected · {mb(pickedBytes)} of files</span>
        <button className="rec-btn-danger" disabled={deleting} onClick={removePicked}>{deleting ? 'Deleting…' : 'Delete selected'}</button>
        <button className="btn-secondary" onClick={() => setPicked(new Set())}>Cancel</button>
      </div>
    )}
    <div className="rec-card rec-table-wrap">
      <table className="rec-table rec-table--list">
        <thead><tr>{isAdmin && <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set((rows ?? []).map((r) => r.id)))} /></th>}<th>Candidate</th><th>Opening</th><th>Stage</th><th>Next step</th><th>Applied</th></tr></thead>
        <tbody>{rows === null ? <tr><td colSpan={6} className="rec-muted">Loading…</td></tr> : rows.length ? rows.map((r) => {
          const n = nextStep(r, isAdmin);
          return (
            <tr key={r.id} className="rec-row" onClick={() => setOpen(r.id)}>
              {isAdmin && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>}
              <td>
                <b>{r.name}</b>
                <div className="rec-sub">{r.ref} · {Number(r.experience_years)} yrs</div>
                {(flagged(r) || Number(r.tab_switches) >= 3) && <div className="rec-flag">{r.interview_paused ? 'Video interview paused' : flagged(r) ? INTEGRITY[r.integrity_status] : `Left the interview tab ${r.tab_switches} times`}</div>}
              </td>
              <td>{r.job_title}</td>
              <td><span className={`rec-pill rec-pill--${tone(r.status)}`}>{r.status_label}</span></td>
              <td><span className={`rec-next rec-next--${n.tone}`}>{n.text}</span></td>
              <td className="rec-sub" style={{ whiteSpace: 'nowrap' }}>{fmtDay(r.created_at)}</td>
            </tr>
          );
        }) : <tr><td colSpan={6} className="rec-empty-row">{queue === 'action' ? 'Nothing needs you right now.' : 'No candidates here.'}</td></tr>}</tbody>
      </table>
    </div>
    {open && <ApplicationDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
  </>);
}


const INTEGRITY: Record<string, string> = {
  monitoring: 'Final warning given', integrity_review_required: 'Integrity review needed', cleared: 'No violation', technical: 'Technical issue',
  suspicious: 'Suspicious, under review', insufficient: 'Insufficient evidence', confirmed: 'Violation confirmed',
};
const INCIDENT: Record<string, string> = { tab_away: 'Left the interview page', fullscreen_exit: 'Left fullscreen', multiple_tabs: 'Opened in a second tab', session_conflict: 'Opened on another device' };
// Integrity review: what happened and, for admins, the decision. Each action asks for a reason (kept in the history).
function IntegrityReview({ iv, admin, done }: { iv: any; admin: boolean; done: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const act = async (title: string, text: string, fn: (reason: string) => Promise<any>, ok: string, danger = false) => {
    const reason = await ask({ title, text, input: { placeholder: 'Reason (saved in the history)', required: true, multiline: true }, confirm: title, danger });
    if (!reason?.trim()) return;
    setBusy(true);
    try { await fn(reason.trim()); notify(ok, 'good'); await done(); } catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); }
  };
  const decide = (outcome: string, reject = false) => (reason: string) => api.integrityReview(iv.id, { outcome, reason, reject });
  const serious = iv.incidents?.some((x: any) => x.serious);
  const open = ['in_progress', 'paused'].includes(iv.status);
  const decided = ['cleared', 'technical', 'insufficient', 'confirmed'].includes(iv.integrity_status);
  const tone = iv.integrity_status === 'confirmed' || iv.status === 'paused' ? 'bad' : decided ? 'good' : 'warn';
  return (
    <div className="rec-int">
      <div className="rec-int__head">
        <h3>Integrity</h3>
        <span className={`rec-pill rec-pill--${tone}`}>{iv.status === 'paused' ? 'Paused · needs review' : INTEGRITY[iv.integrity_status] ?? 'No issues'}</span>
      </div>
      <p className="rec-int__sum">
        <b>{iv.warnings}</b> of {iv.max_warnings} warnings
        {iv.status === 'paused' && <> · paused {dt(iv.paused_at)} {iv.paused_by === 'auto' ? (serious ? 'after a serious incident' : 'after too many warnings') : 'by an admin'}</>}
        {iv.status === 'terminated' && <> · interview closed</>}
      </p>
      {iv.incidents?.length > 0 && <ol className="rec-int__list">{iv.incidents.map((x: any) => (
        <li key={x.id} className={x.serious ? 'is-serious' : ''}>
          <span>{INCIDENT[x.kind] ?? x.kind}{x.position != null ? ` · Q${x.position + 1}` : ''}</span>
          <small>{dt(x.at)}{x.status !== 'open' ? ` · ${x.status}` : ''}</small>
        </li>))}</ol>}
      {admin && !decided && (
        <div className="rec-int__actions">
          <button className="btn-secondary" disabled={busy} onClick={() => act('Not cheating', 'The warnings are cleared and stop counting.', decide('no_violation'), 'Marked as not cheating')}>Not cheating</button>
          <button className="btn-secondary" disabled={busy} onClick={() => act('Technical issue', 'Recorded as a technical problem, not misconduct.', decide('technical'), 'Marked as a technical issue')}>Technical issue</button>
          {iv.status === 'paused' && <button className="btn-secondary" disabled={busy} onClick={() => act('Resume interview', 'The candidate can continue from the current question.', (r) => api.resumeInterview(iv.id, r), 'Interview resumed')}>Resume interview</button>}
          <button className="rec-btn-danger" disabled={busy} onClick={() => act('Confirm cheating & reject', 'The interview is closed and the application rejected. The candidate cannot apply for this role again for 3 months.', decide('confirmed', true), 'Cheating confirmed, application rejected', true)}>Confirm cheating &amp; reject</button>
          {open && iv.status !== 'paused' && <button className="btn-secondary" disabled={busy} onClick={() => act('Close interview', 'The interview stops; the application stays as it is.', (r) => api.terminateInterview(iv.id, r), 'Interview closed', true)}>Close interview</button>}
        </div>
      )}
      {!admin && !decided && <p className="rec-muted rec-int__note">An admin will review this.</p>}
    </div>
  );
}

const SEV_ORDER: Record<string, number> = { warning: 2, notice: 1, info: 0 };
// Interview activity for reviewers: summary, live status and the full timeline. Indicators to check against the
// recording; nothing here rejects anyone.
function Monitoring({ m, who, verification }: { m: any; who: string; verification: string | null }) {
  const [min, setMin] = useState<'info' | 'notice' | 'warning'>('notice');
  const rows = m.timeline.filter((e: any) => SEV_ORDER[e.severity] >= SEV_ORDER[min]);
  const csv = () => {
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Time (page)', 'Received by server', 'Event', 'Severity', 'Source', 'Question', 'Duration (s)', 'Detail', 'Grouped with'].map(q).join(',')]
      .concat(m.timeline.map((e: any) => [e.at, e.received_at, e.label, e.severity, e.source, e.position != null ? e.position + 1 : '', e.duration_seconds ?? '', e.detail, e.grouped.join(' ')].map(q).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const l = document.createElement('a'); l.href = url; l.download = `interview-activity-${who.split(' ')[0]}.csv`; l.click(); URL.revokeObjectURL(url);
  };
  const stat = (label: string, v: any, warn = false) => <div className={`rec-mon-stat ${warn ? 'rec-mon-stat--warn' : ''}`}><b>{v}</b><span>{label}</span></div>;
  return (<>
    <h3 style={{ marginTop: 12 }}>Interview Activity &amp; Monitoring</h3>
    <p className="rec-muted" style={{ marginTop: 0 }}>Browser and connection indicators. They cannot show what the candidate did or why: review them with the recording. Nothing here rejects anyone automatically.</p>
    <dl className="rec-kv">
      <dt>Interview</dt><dd>{m.live}</dd>
      <dt>Recording check</dt><dd>{verification ?? 'Not yet'}</dd>
    </dl>
    <div className="rec-mon-grid">
      {stat('tab switches', m.tab_switches, m.tab_switches >= 3)}
      {stat('away in total', `${m.away_seconds} s`, m.away_seconds >= 60)}
      {stat('longest absence', `${m.longest_away_seconds} s`, m.longest_away_seconds >= 30)}
      {stat('other window / app', m.focus_losses)}
      {stat('fullscreen exits', m.fullscreen_exits)}
      {stat('connection interruptions', m.connection, m.connection > 0)}
      {stat('camera / mic interruptions', m.devices, m.devices > 0)}
      {stat('recording interruptions', m.recording, m.recording > 0)}
      {stat('other tab / device', m.conflicts, m.conflicts > 0)}
      {stat('reloads / reopened', m.reloads)}
    </div>
    <div className="rec-mon-bar">
      <select className="form-input" value={min} onChange={(e) => setMin(e.target.value as any)} aria-label="Show events">
        <option value="warning">Warnings only</option><option value="notice">Notices and warnings</option><option value="info">Everything</option>
      </select>
      <button type="button" className="btn-secondary" onClick={csv}>Download report (CSV)</button>
    </div>
    {rows.length === 0 ? <p className="rec-muted">Nothing at this level.</p> : (
      <ul className="rec-timeline">{rows.map((e: any) => (
        <li key={e.id} className={`rec-mon-ev rec-mon-ev--${e.severity}`}>
          {e.label}{e.position != null ? ` · Q${e.position + 1}` : ''}{e.duration_seconds ? ` · ${e.duration_seconds} s` : ''}{e.detail && !/^away \d+ s$/.test(e.detail) ? ` · ${e.detail}` : ''}
          <div className="rec-sub">{dt(e.at)}{e.received_at && Math.abs(new Date(e.received_at).getTime() - new Date(e.at).getTime()) > 5000 ? ` · received ${dt(e.received_at)}` : ''} · {e.source === 'server' ? 'recorded by the server' : 'reported by the page'}{e.grouped.length ? ' · includes the window focus change' : ''}</div>
        </li>))}
      </ul>
    )}
  </>);
}

// A titled group of label/value rows (empty values show as a dash)
function Facts({ title, rows }: { title: string; rows: [string, any][] }) {
  return (
    <div className="rec-facts">
      <div className="rec-facts__title">{title}</div>
      {rows.map(([k, v]) => <div key={k} className="rec-facts__row"><span>{k}</span><b>{v === null || v === undefined || v === '' ? '—' : v}</b></div>)}
    </div>
  );
}
// History entries in plain words
const HISTORY_LABEL: Record<string, string> = {
  applied: 'Applied', approve: 'Approved', reject: 'Rejected', reopen: 'Reopened', withdrawn: 'Candidate withdrew',
  review_started: 'Review started', interview_started: 'Video interview started', interview_submitted: 'Video interview submitted',
  interview_paused: 'Video interview paused', interview_resumed: 'Video interview resumed', interview_terminated: 'Video interview ended by an admin',
  integrity_review: 'Integrity review', recording_opened: 'Recording watched', recording_deleted: 'Recording deleted', resume_opened: 'Resume opened',
  interview_scheduled: 'Final interview scheduled', interview_rescheduled: 'Final interview time changed', interview_cancelled: 'Final interview cancelled',
  final_completed: 'Final interview marked completed', reschedule_requested: 'Candidate asked to reschedule', reschedule_approved: 'Reschedule accepted',
  reschedule_rejected: 'Reschedule declined', interviewer_feedback: 'Interviewer feedback', interview_issue: 'Interview problem reported',
  interview_issue_handled: 'Interview problem handled', reapply_allowed: 'Allowed to reapply early', whatsapp_confirmed: 'WhatsApp confirmed', email: 'Email',
};
const dayOf = (v: any) => { const d = toDateSafe(v); return d ? fmtDay(d) : ''; };
const toDateSafe = (v: any) => { if (!v) return null; const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v).includes('T') || String(v).includes('Z') ? v : String(v).replace(' ', 'T') + 'Z'); return isNaN(d.getTime()) ? null : d; };

function ApplicationDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [a, setA] = useState<any>(null); const [media, setMedia] = useState<{ status: string | null; final: string | null; parts: any[] } | null>(null);
  const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null); const [now, setNow] = useState(0);
  const [tab, setTab] = useState<'' | 'profile' | 'interview' | 'final' | 'history'>('');
  const seek = (t: number) => { const v = video.current; if (!v) return; v.currentTime = t; v.scrollIntoView({ behavior: 'smooth', block: 'center' }); void v.play().catch(() => undefined); };
  const [sched, setSched] = useState<any>(null);
  const load = async () => {
    const r = await api.application(id); setA(r.data);
    if (r.data.interview && !r.data.interview.recording_deleted_at) await loadMedia(r.data.interview.id);
  };
  const loadMedia = (ivId: number) => api.recordingLinks(ivId).then((x) => setMedia(x.data)).catch(() => setMedia(null));
  useEffect(() => { load().catch((e) => notify(err(e), 'bad')); }, [id]);
  // While the recording is being built, check again every few seconds: no manual refresh needed
  const processing = a?.interview?.processing_status === 'processing';
  useEffect(() => { if (!processing) return; const t = setInterval(() => load().catch(() => undefined), 4000); return () => clearInterval(t); }, [processing, id]);
  // A live interview: new activity arrives over the socket; a regular re-check covers a dropped socket
  const { socket } = useSocket();
  const liveIv = ['in_progress', 'paused'].includes(a?.interview?.status);
  useEffect(() => {
    if (!liveIv) return;
    const on = (m: any) => { if (Number(m?.application_id) === id) load().catch(() => undefined); };
    socket?.on('rec:activity', on);
    const t = setInterval(() => load().catch(() => undefined), 15000);
    return () => { socket?.off('rec:activity', on); clearInterval(t); };
  }, [liveIv, id, socket]);
  const refresh = async () => { await load(); onChanged(); };
  const decide = async (action: 'approve' | 'reject' | 'reopen') => {
    if (action === 'reject' && !comment.trim()) { notify('Please add a reason for rejecting', 'bad'); return; }
    setBusy(true);
    try { await api.decide(id, action, comment || undefined); setComment(''); await refresh(); } catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); }
  };
  const [newLink, setNewLink] = useState('');
  // Deletes the recording's files for good; the application, answers' timings and history stay
  const deleteVideo = async () => {
    if (!a?.interview) return;
    if ((await ask({ title: 'Delete this interview video?', text: 'It is deleted for good and cannot be recovered. The application and its history stay. Type DELETE to confirm.', input: { placeholder: 'DELETE', match: 'DELETE' }, confirm: 'Delete video', danger: true })) === null) return;
    setBusy(true);
    try { const r = await api.deleteRecording(a.interview.id); notify(`Video deleted${r.data.freed_bytes ? `, ${(r.data.freed_bytes / 1048576).toFixed(1)} MB freed` : ''}.`, 'good'); setMedia(null); await refresh(); }
    catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); }
  };
  const linkAction = async (mode: 'new' | 'extend') => {
    setBusy(true);
    try { const r = await api.interviewLink(id, mode); setNewLink(r.data.link ?? ''); await refresh(); } catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); }
  };
  const allowReapply = async () => {
    const reason = await ask({ title: 'Allow reapplying now?', text: 'Why may this candidate apply for this role again before the 3 months are up? This is recorded.', input: { placeholder: 'Reason', required: true, multiline: true }, confirm: 'Allow' });
    if (!reason?.trim()) return;
    setBusy(true);
    try { await api.allowReapply(id, reason.trim()); await refresh(); } catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); }
  };
  const resume = async (download = false) => { try { const r = await api.resumeLink(id); window.open(r.data.url + (download ? '&download=1' : ''), '_blank', 'noopener'); } catch (e) { notify(err(e), 'bad'); } };
  const saveEval = async (ev: any) => { try { await api.evaluate(id, ev); await load(); notify('Evaluation saved', 'good'); return true; } catch (e) { notify(err(e), 'bad'); return false; } };
  const current = useMemo(() => a?.schedules?.find((s: any) => s.status === 'scheduled'), [a]);
  if (!a) return <Drawer title="Application" onClose={onClose}><div className="drawer-body rec-muted">Loading…</div></Drawer>;
  const iv = a.interview;
  // Opens where the work is: the video while it is reviewed, the final interview once it is approved
  const askedReschedule = (a.reschedule_requests ?? []).some((r: any) => r.status === 'pending') || (a.interview_issues ?? []).some((i: any) => i.open);
  const view = tab || (askedReschedule || ['prelim_approved', 'final_scheduled', 'final_completed'].includes(a.status) ? 'final' : a.interview?.status === 'submitted' && !['selected', 'rejected', 'withdrawn'].includes(a.status) ? 'interview' : 'profile');
  const nextLabel = ['final_completed', 'final_scheduled'].includes(a.status) ? 'Shortlist candidate (final decision)' : user?.role === 'admin' ? (['applied', 'under_review', 'interview_review'].includes(a.status) ? 'Approve (admin decision)' : 'Approve') : 'Approve (recommend)';
  return (
    <Drawer title={a.name} label={`${a.ref} · ${a.job?.title ?? ''}`} onClose={onClose}>
      <div className="drawer-body" style={{ overflowY: 'auto' }}>
        {a.identity?.related?.length > 0 && (
          <details className={`rec-ident ${a.identity.conflict ? 'rec-ident--warn' : ''}`}>
            <summary>
              <b>{a.identity.conflict ? 'Same phone number, different email' : 'Other applications from this person'}</b>
              <span className="rec-muted"> · {a.identity.related.length} other application{a.identity.related.length > 1 ? 's' : ''} · show</span>
            </summary>
            {a.identity.conflict && <p className="rec-muted">Could be the same person with another email, or a shared phone. Check before deciding; nothing is merged.</p>}
            <ul>
              {a.identity.related.map((r: any) => <li key={r.ref}><b>{r.ref}</b> · {r.job ?? 'job'} · <span className="rec-muted">{r.status_label} · same {r.match}</span></li>)}
            </ul>
          </details>
        )}
        {(() => {
          // Same "next step" as the list, worked out from this candidate's details
          const cur = (a.schedules ?? []).find((x: any) => ['scheduled', 'completed'].includes(x.status));
          const names = (cur?.interviewers ?? []).map((p: any) => p.name);
          const answered = new Set([...(a.interviewer_feedback ?? []).map((x: any) => x.user_name), ...(a.interview_issues ?? []).map((x: any) => x.user_name)]);
          const n = nextStep({
            status: a.status,
            issue_open: (a.interview_issues ?? []).some((i: any) => i.open),
            reschedule_pending: (a.reschedule_requests ?? []).some((r: any) => r.status === 'pending'),
            feedback: names.length ? { done: names.filter((x: string) => answered.has(x)), waiting: names.filter((x: string) => !answered.has(x)) } : null,
          }, user?.role === 'admin');
          return (
            <div className="rec-nextbar">
              <span className={`rec-pill rec-pill--${tone(a.status)}`}>{a.status_label}</span>
              <span className={`rec-next rec-next--${n.tone}`}>Next: {n.text}</span>
            </div>
          );
        })()}
        {askedReschedule && view !== 'final' && (
          <div className="rec-resched"><b>{(a.interview_issues ?? []).some((i: any) => i.open) ? 'An interviewer reported a problem with the interview.' : 'The candidate asked to reschedule.'}</b> <button className="btn-primary" style={{ marginLeft: 8 }} onClick={() => setTab('final')}>Review it</button></div>
        )}
        <div className="rec-tabs rec-dtabs">
          {([['profile', 'Profile'], ['interview', 'Video interview'], ['final', 'Final interview'], ['history', 'History']] as const).map(([k, l]) => <button key={k} className={`rec-tab ${view === k ? 'rec-tab--on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {view === 'profile' && <>

        <div className="rec-filebox">
          <div><div className="rec-filebox__label">Resume</div><div className="rec-filebox__name">{a.resume_name || 'Resume'}</div></div>
          <div className="rec-actions"><button className="btn-primary" onClick={() => resume()}>View</button><button className="btn-secondary" onClick={() => resume(true)}>Download</button></div>
        </div>
        <div className="rec-groups">
          <Facts title="Contact" rows={[['Email', a.email], ['Phone', a.phone], ['Location', a.location]]} />
          <Facts title="Background" rows={[['Qualification', a.education], ['Relevant experience', `${Number(a.experience_years)} years`], ['Company', a.company]]} />
          <Facts title="Application" rows={[['Opening', a.job?.title], ['Department', a.job?.department], ['Interview preference', a.interview_mode === 'online' ? 'Online' : a.interview_mode === 'walkin' ? 'Walk-in' : null], ['Applied', dt(a.created_at)]]} />
          {a.current_ctc !== undefined && <Facts title="Salary (admins only)" rows={[['Current CTC', a.current_ctc], ['Expected CTC', a.expected_ctc]]} />}
        </div>
        {a.skills && <div className="rec-section"><h3>Skills</h3><p className="careers-text" style={{ margin: 0 }}>{a.skills}</p></div>}

        {user?.role === 'admin' && a.status === 'rejected' && !a.reapply_override_at && (
          <div className="rec-section"><h3>Reapplying</h3>
            <p className="rec-muted">This candidate can apply for this role again 3 months after the rejection. An admin can allow it sooner.</p>
            <div className="rec-actions"><button className="btn-secondary" disabled={busy} onClick={allowReapply}>Allow reapplying now…</button></div>
          </div>
        )}

        </>}
        {view === 'interview' && <>
        {user?.role === 'admin' && a.status === 'prelim_pending' && iv?.status !== 'submitted' && (
          <div className="rec-section"><h3>Interview link</h3>
            <p className="rec-muted">Valid until {a.interview_expires_at ? dt(a.interview_expires_at) : '—'}. A new link stops the old one working; an interview already started keeps its questions and timer.</p>
            <div className="rec-actions">
              <button className="btn-secondary" disabled={busy} onClick={() => linkAction('new')}>Send a new link</button>
              <button className="btn-secondary" disabled={busy} onClick={() => linkAction('extend')}>Extend current link</button>
            </div>
            {newLink && <p className="rec-muted" style={{ wordBreak: 'break-all' }}>New link (also emailed when email is on): {newLink}</p>}
          </div>
        )}
        {iv && (
          <div className="rec-section"><h3>Video interview</h3>
            <div className="rec-factgrid">
              <div><span>Started</span><b>{dt(iv.started_at)}</b></div>
              <div><span>Submitted</span><b>{iv.submitted_at ? dt(iv.submitted_at) : 'Not yet'}</b></div>
              <div><span>Duration</span><b>{iv.duration_sec ? `${Math.floor(iv.duration_sec / 60)}m ${iv.duration_sec % 60}s` : '—'}</b></div>
              <div><span>Recording</span><b><RecordingStatus iv={iv} /></b></div>
              <div><span>Consent</span><b>{dt(iv.consent_at)} · {iv.consent_version}</b></div>
            </div>
            {iv.verification && <Verification v={iv.verification} />}
            {media && !iv.recording_deleted_at && (media.final || media.parts.length > 0) && (
              <div className="rec-actions" style={{ margin: '4px 0 8px' }}>
                {media.final && <a className="btn-secondary" href={`${media.final}&download=1`} download style={{ textDecoration: 'none' }}>Download video</a>}
                {user?.role === 'admin' && <button className="rec-btn-danger" disabled={busy} onClick={deleteVideo}>Delete video</button>}
              </div>
            )}
            {media && !iv.recording_deleted_at && (media.final
              ? <><FinalVideo url={media.final} refresh={() => loadMedia(iv.id)} video={video} onTime={setNow} /><QuestionTrack questions={iv.questions ?? []} now={now} seek={seek} /></>
              : media.parts.length > 0 && iv.processing_status !== 'processing' && <><p className="rec-muted">Not a verified recording: the uploaded parts as received.</p><Recording parts={media.parts} /></>)}
            <EvaluationNotes list={a.evaluations} videoNow={media?.final ? Math.floor(now) : null} seek={seek} save={saveEval} />
            {(iv.incidents?.length > 0 || iv.status === 'paused' || iv.integrity_status) && <IntegrityReview iv={iv} admin={user?.role === 'admin'} done={refresh} />}
            {iv.monitoring && <Monitoring m={iv.monitoring} who={`${a.ref} ${a.name}`} verification={iv.processing_status} />}
          </div>
        )}

        {!iv && a.evaluations.length > 0 && <div className="rec-section"><EvaluationNotes list={a.evaluations} videoNow={null} seek={seek} save={saveEval} /></div>}

        {!iv && <p className="rec-muted">The candidate has not started the video interview yet.</p>}
        </>}
        {view === 'final' && !(a.status === 'prelim_approved' || a.schedules.length > 0) && <p className="rec-muted">The final interview can be scheduled once the video interview is approved.</p>}
        {view === 'final' && (a.status === 'prelim_approved' || a.schedules.length > 0) && (
          <>
            {/* 1. What needs attention first */}
            {(a.interview_issues ?? []).filter((i: any) => i.open).map((i: any) => (
              <div key={`i${i.id}`} className="rec-resched">
                <b>{i.label}</b> — reported by {i.user_name}{i.note ? <div style={{ fontSize: 13, marginTop: 2 }}>“{i.note}”</div> : null}
                <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="rec-muted">Change the time, cancel the interview, make the final decision, or:</span>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '3px 10px' }} disabled={busy} onClick={async () => { setBusy(true); try { await api.resolveIssue(id, i.id); await load(); } catch (e) { notify(err(e), 'bad'); } finally { setBusy(false); } }}>Mark as handled</button>
                </div>
              </div>
            ))}
            {current && (a.reschedule_requests ?? []).filter((r: any) => r.status === 'pending' || (r.status === 'rejected' && r.decided_by && !r.followed_up)).slice(0, 1).map((r: any) => {
              // Same length as the current slot, starting at the requested time
              const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
              const end = Math.min(mins(r.start_time) + mins(current.end_time) - mins(current.start_time), 23 * 60 + 59);
              const endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
              const base = { ...current, interviewer_ids: current.interviewers.map((p: any) => p.id), sid: current.id };
              return (
                <div key={r.id} className="rec-resched">
                  <b>{r.status === 'pending' ? 'The candidate asked to reschedule' : 'You rejected this reschedule request, but no new time has been sent yet'}</b>
                  <div>{r.type === 'online' ? 'Online' : 'Walk-in'} · {fmtDay(r.date)} at {r.start_time} IST</div>
                  <div className="rec-muted">Reason: {r.reason}</div>
                  <div className="rec-actions">
                    <button className="btn-primary" onClick={() => setSched({ ...base, type: r.type, date: r.date, start_time: r.start_time, end_time: endTime, request_id: r.id, location: base.location || a.schedule_defaults?.location, address: base.address || a.schedule_defaults?.address })}>{r.status === 'pending' ? 'Accept this new time' : 'Accept their time instead'}</button>
                    {r.status === 'rejected' && <button className="btn-secondary" onClick={() => setSched(base)}>Set my own time</button>}
                    {r.status === 'pending' && <button className="rec-btn-danger" onClick={async () => { const note = await ask({ title: 'Decline this reschedule request?', text: 'The candidate stays in the process. Next, set the time you want; they get the usual interview email.', input: { placeholder: 'Note (optional)' }, confirm: 'Decline and set my own time', danger: true }); if (note === null) return; try { await api.rejectReschedule(id, r.id, String(note || '')); await refresh(); setSched(base); } catch (e) { notify(err(e), 'bad'); } }}>Decline request</button>}
                  </div>
                </div>
              );
            })}

            {/* 2. The interview itself */}
            <div className="rec-section"><h3>Final interview</h3>
              {(() => {
                const s = current ?? a.schedules.find((x: any) => x.status === 'completed');
                if (!s) return <p className="rec-muted" style={{ margin: '0 0 10px' }}>Not scheduled yet.</p>;
                return (
                  <div className="rec-ivcard">
                    <div className="rec-factgrid">
                      <div><span>Status</span><b><span className={`rec-pill ${s.status === 'scheduled' ? 'rec-pill--info' : 'rec-pill--good'}`}>{s.status === 'scheduled' ? 'Scheduled' : 'Completed'}</span></b></div>
                      <div><span>Date</span><b>{fmtDay(s.date)}</b></div>
                      <div><span>Time</span><b>{s.start_time}–{s.end_time} IST</b></div>
                      <div><span>Type</span><b>{s.type === 'online' ? 'Online' : 'Walk-in'}</b></div>
                      <div className="rec-factgrid__wide"><span>{s.type === 'online' ? 'Meeting link' : 'Venue'}</span><b>{s.type === 'online' ? <a href={s.meeting_url} target="_blank" rel="noreferrer">{s.meeting_url}</a> : `${s.location ?? ''} ${s.address ?? ''}`}</b></div>
                      <div className="rec-factgrid__wide"><span>Interviewers</span><b>{s.interviewers.length ? s.interviewers.map((p: any) => p.name).join(', ') : 'None assigned'}</b></div>
                    </div>
                  </div>
                );
              })()}
              <div className="rec-actions">
              {a.status === 'prelim_approved' && <button className="btn-primary" onClick={() => setSched({ type: a.interview_mode || 'walkin', location: a.schedule_defaults?.location ?? '', address: a.schedule_defaults?.address ?? '' })}>Schedule final interview</button>}
              {current && <>
                <button className="btn-secondary" onClick={() => setSched({ ...current, interviewer_ids: current.interviewers.map((p: any) => p.id), sid: current.id })}>Change time</button>
                <button className="rec-btn-danger" onClick={async () => { const reason = await ask({ title: 'Cancel the final interview?', text: 'The candidate is told it is cancelled.', input: { placeholder: 'Reason for cancelling', required: true }, confirm: 'Cancel interview', danger: true }); if (!reason) return; try { await api.cancelSchedule(id, current.id, reason); await refresh(); } catch (e) { notify(err(e), 'bad'); } }}>Cancel interview</button>
                <button className="btn-secondary" onClick={async () => { try { await api.finalCompleted(id); await refresh(); } catch (e) { notify(err(e), 'bad'); } }}>Mark interview completed</button>
              </>}
            </div>
              {a.schedules.filter((x: any) => x.status === 'cancelled').length > 0 && (
                <details className="rec-earlier"><summary>Cancelled interviews ({a.schedules.filter((x: any) => x.status === 'cancelled').length})</summary>
                  {a.schedules.filter((x: any) => x.status === 'cancelled').map((x: any) => <div key={x.id} className="rec-muted">{fmtDay(x.date)} {x.start_time}–{x.end_time} · {x.type === 'online' ? 'Online' : 'Walk-in'}</div>)}
                </details>
              )}
            </div>

            {/* 3. What the interviewers said; the admin's decision (below) is final */}
            <div className="rec-section"><h3>Interviewer feedback</h3>
              {(a.interviewer_feedback ?? []).length === 0 ? <p className="rec-muted" style={{ margin: 0 }}>No feedback yet. Interviewers send it from Loop → My Interviews.</p> : (
                <>
                  <div className="rec-fbsum">
                    <span><b>{(a.interviewer_feedback as any[]).filter((f) => f.recommendation === 'approve').length}</b> recommend approving</span>
                    <span><b>{(a.interviewer_feedback as any[]).filter((f) => f.recommendation === 'reject').length}</b> recommend rejecting</span>
                    <span>Average <b>{((a.interviewer_feedback as any[]).reduce((t, f) => t + Number(f.rating), 0) / a.interviewer_feedback.length).toFixed(1)}/5</b></span>
                  </div>
                  {(a.interviewer_feedback as any[]).map((f) => (
                    <div key={f.id} className="rec-fb">
                      <div className="rec-fb__head">
                        <b>{f.user_name}</b>
                        <span className={`rec-pill ${f.recommendation === 'approve' ? 'rec-pill--good' : 'rec-pill--bad'}`}>{f.recommendation === 'approve' ? 'Recommends approve' : 'Recommends reject'}</span>
                        <span className="rec-fb__stars">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)} {f.rating}/5</span>
                      </div>
                      <div className="rec-fb__notes">{f.notes}</div>
                    </div>
                  ))}
                </>
              )}
              {(a.interview_issues ?? []).filter((i: any) => !i.open).map((i: any) => (
                <div key={`h${i.id}`} className="rec-muted" style={{ fontSize: 12, marginTop: 8 }}>{i.user_name} reported “{i.label}”{i.note ? ` — ${i.note}` : ''} · handled{i.resolved_by_name ? ` by ${i.resolved_by_name}` : ''}{i.resolution ? ` (${i.resolution})` : ''}</div>
              ))}
            </div>
          </>
        )}

        {view === 'history' && <>
        <div className="rec-section"><h3>History</h3>
          {(() => {
            const days: [string, any[]][] = [];
            for (const h of a.history) {
              const d = dayOf(h.created_at); const last = days[days.length - 1];
              const list = last && last[0] === d ? last[1] : (days.push([d, []]), days[days.length - 1][1]);
              // The same thing done again by the same person with no comment (e.g. watching the recording): one line, counted
              const prev = list[list.length - 1];
              if (prev && prev.action === h.action && prev.actor_name === h.actor_name && !h.comment && !prev.comment && !h.override) { prev.times = (prev.times ?? 1) + 1; continue; }
              list.push({ ...h });
            }
            return days.map(([d, list]) => (
              <div key={d} className="rec-hday">
                <div className="rec-hday__date">{d}</div>
                <ul className="rec-timeline">{list.map((h: any) => (
                  <li key={h.id}>
                    <b>{HISTORY_LABEL[h.action] ?? h.action.replace(/_/g, ' ')}</b>{h.times > 1 && <span className="rec-hcount">×{h.times}</span>}{h.override ? <span className="rec-override"> · admin override</span> : null}
                    <span className="rec-sub"> · {h.actor_name ?? 'Candidate'}{h.actor_role ? ` (${h.actor_role})` : ''} · {toDateSafe(h.created_at)?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) ?? ''}</span>
                    {h.comment && <div className="rec-hcomment">{h.comment}</div>}
                  </li>))}</ul>
              </div>
            ));
          })()}
        </div>

        {user?.role === 'admin' && (
          <div className="rec-section"><h3>Data</h3>
            <div><button className="rec-btn-danger" onClick={async () => { if ((await ask({ title: `Delete all data for ${a.name}?`, text: 'Their application, history, scores, interview, resume and recording are deleted for good.', confirm: 'Delete', danger: true })) === null) return; try { await api.deleteCandidate(id); onChanged(); onClose(); } catch (e) { notify(err(e), 'bad'); } }}>Delete candidate data</button></div>
          </div>
        )}
        </>}
      </div>
      {(a.can.length > 0 || ['admin_review', 'interview_admin_review', 'final_completed'].includes(a.status)) && (
        <div className="rec-footer">
          {a.can.length > 0 ? <>
            <input className="form-input" placeholder={a.can.includes('reject') ? 'Comment (required to reject)' : 'Comment (optional)'} value={comment} onChange={(e) => setComment(e.target.value)} />
            {a.can.includes('reject') && <button className="rec-btn-danger" disabled={busy} onClick={() => decide('reject')}>Reject candidate</button>}
            {a.can.includes('reopen') && <button className="btn-secondary" disabled={busy} onClick={() => decide('reopen')}>Reopen</button>}
            {a.can.includes('approve') && <button className="btn-primary" disabled={busy} onClick={() => decide('approve')}>{nextLabel}</button>}
          </> : <span className="rec-muted">Waiting for an admin decision.</span>}
          {a.can.length > 0 && user?.role === 'manager' && <span className="rec-muted rec-footer-note">Your approval goes to an admin for the final decision.</span>}
        </div>
      )}
      {sched && <ScheduleForm appId={id} prefers={a.interview_mode} initial={{ location: a.schedule_defaults?.location ?? '', address: a.schedule_defaults?.address ?? '', ...sched }} onClose={() => setSched(null)} onSaved={async () => { setSched(null); await refresh(); }} />}
    </Drawer>
  );
}

function ScheduleForm({ appId, prefers, initial, onClose, onSaved }: { appId: number; prefers?: string | null; initial: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ type: 'walkin', date: '', start_time: '10:00', end_time: '11:00', location: '', address: '', meeting_url: '', instructions: '', interviewer_ids: [], ...initial });
  const [staff, setStaff] = useState<any[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.staff().then((r) => setStaff(r.data)).catch(() => {}); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError('');
    try { if (f.sid) await api.reschedule(appId, f.sid, f); else await api.schedule(appId, f); onSaved(); } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.sid ? 'Reschedule final interview' : 'Schedule final interview'} onClose={onClose} size="lg" dismissible={false}>
      <div className="rec-grid2">
        <div className="rec-field rec-field--full"><label>Interview mode</label>
          <select className="form-input" value={f.type} onChange={set('type')}><option value="walkin">Walk-in (at the office)</option><option value="online">Online (video call)</option></select>
          {prefers && <span className="rec-muted">Candidate's preference: <b>{prefers === 'online' ? 'Online' : 'Walk-in'}</b>{prefers !== f.type ? ' (changed by you)' : ''}</span>}
        </div>
        <div className="rec-field"><label>Date *</label><input className="form-input" type="date" value={f.date} onChange={set('date')} /></div>
        <div className="rec-grid2"><div className="rec-field"><label>Start *</label><input className="form-input" type="time" value={f.start_time} onChange={set('start_time')} /></div><div className="rec-field"><label>End *</label><input className="form-input" type="time" value={f.end_time} onChange={set('end_time')} /></div></div>
        {f.type === 'walkin' ? (<>
          <div className="rec-field"><label>Location (Google Maps link)</label><input className="form-input" value={f.location ?? ''} onChange={set('location')} /></div>
          <div className="rec-field rec-field--full"><label>Address *</label><textarea className="form-input" rows={2} value={f.address ?? ''} onChange={set('address')} /></div>
        </>) : <div className="rec-field rec-field--full"><label>Meeting link * (https://…)</label><input className="form-input" value={f.meeting_url ?? ''} onChange={set('meeting_url')} placeholder="https://meet.google.com/…" /></div>}
        <div className="rec-field rec-field--full"><label>Interviewers <span className="rec-muted">· {(f.interviewer_ids ?? []).length} selected · the first one ticked is the candidate's contact</span></label>
          <div className="rec-checklist">
            {staff.map((p) => {
              const ids: number[] = f.interviewer_ids ?? []; const on = ids.includes(p.id);
              return <label key={p.id} className={`rec-check ${on ? 'rec-check--on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => setF({ ...f, interviewer_ids: on ? ids.filter((x) => x !== p.id) : [...ids, p.id] })} />
                <span>{p.name}</span><span className="rec-muted">{p.role}</span>{on && ids[0] === p.id && <span className="rec-pill rec-pill--info">contact</span>}
              </label>;
            })}
          </div>
        </div>
        <div className="rec-field rec-field--full"><label>Instructions for the candidate</label><textarea className="form-input" rows={2} value={f.instructions ?? ''} onChange={set('instructions')} /></div>
        {f.sid && <div className="rec-field rec-field--full"><label>Reason for the change</label><input className="form-input" value={f.reason ?? ''} onChange={set('reason')} /></div>}
      </div>
      {error && <p className="rec-error">{error}</p>}
      <p className="rec-muted">The candidate is emailed the details and sees them on their tracking page.</p>
      <div className="rec-actions"><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button><button className="btn-secondary" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

// ── Question bank ──
// One tab per role (department) plus "All roles": every active question in a role's tab is asked in that role's
// video interview, after the "All roles" ones, in the order shown
function Questions({ departments }: { departments: any[] }) {
  const [qs, setQs] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null); const [preview, setPreview] = useState<any>(null);
  const [role, setRole] = useState<string>('all');
  const [order, setOrder] = useState<number[] | null>(null);   // a changed order not saved yet (ids, this tab)
  const [shuffle, setShuffle] = useState<{ general: boolean; roles: Record<string, boolean> }>({ general: false, roles: {} });
  const load = () => { api.questions().then((r) => { setQs(r.data); setOrder(null); }).catch(() => {}); api.questionShuffle().then((r) => setShuffle(r.data)).catch(() => {}); };
  useEffect(() => { load(); }, []);
  useEffect(() => setOrder(null), [role]);
  const roleId = role === 'all' ? null : Number(role);
  const inTab = (q: any) => (roleId == null ? q.department_id == null : Number(q.department_id) === roleId);
  const inOrder = qs.filter(inTab);
  const shown = order ? order.map((id) => inOrder.find((q) => q.id === id)).filter(Boolean) as any[] : inOrder;
  // Moving a question: rows slide to their new place and the moved one flashes, so it's clear what changed
  const rowEls = useRef(new Map<number, HTMLTableRowElement>());
  const before = useRef(new Map<number, number>()); const movedId = useRef<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const was = useMemo(() => new Map(inOrder.map((q: any, i: number) => [q.id, i])), [inOrder]);
  const place = (id: number, to: number) => {
    const ids = shown.map((q) => q.id).filter((x) => x !== id);
    if (to < 0 || to > ids.length) return;
    ids.splice(to, 0, id);
    if (ids.join() === shown.map((q) => q.id).join()) return;
    before.current = new Map([...rowEls.current].map(([k, el]) => [k, el.getBoundingClientRect().top]));
    movedId.current = id;
    setOrder(ids.join() === inOrder.map((q: any) => q.id).join() ? null : ids);   // back to the saved order: nothing to save
  };
  const move = (i: number, d: number) => place(shown[i].id, i + d);
  const orderKey = shown.map((q) => q.id).join();
  useLayoutEffect(() => {
    if (!before.current.size) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const [id, el] of rowEls.current) {
      const dy = (before.current.get(id) ?? 0) - el.getBoundingClientRect().top;
      if (dy && !still) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (id === movedId.current) el.animate([{ backgroundColor: 'rgba(99,102,241,.18)' }, { backgroundColor: 'transparent' }], { duration: still ? 600 : 1200, easing: 'ease-out' });
    }
    before.current = new Map();
  }, [orderKey]);
  const saveOrder = async () => { try { await api.saveQuestionOrder(order!); notify('Order saved', 'good'); load(); } catch (e) { notify(err(e), 'bad'); } };
  const shuffleOn = roleId == null ? shuffle.general : !!shuffle.roles[String(roleId)];
  const toggleShuffle = async () => { try { await api.setQuestionShuffle(roleId, !shuffleOn); notify(!shuffleOn ? 'Questions will be shuffled for each candidate' : 'Questions will be asked in this order', 'good'); load(); } catch (e) { notify(err(e), 'bad'); } };
  const general = qs.filter((q) => q.department_id == null && q.active).length;
  const count = (id: number | null) => qs.filter((q) => (id == null ? q.department_id == null : Number(q.department_id) === id) && q.active).length;
  const save = async () => { try { if (edit.id) await api.updateQuestion(edit.id, edit); else await api.addQuestion(edit); notify(edit.id ? 'Question saved' : 'Question added', 'good'); setEdit(null); load(); } catch (e) { notify(err(e), 'bad'); } };
  const toggle = async (q: any) => { try { await api.updateQuestion(q.id, { active: !q.active }); load(); } catch (e) { notify(err(e), 'bad'); } };
  const remove = async (q: any) => { if ((await ask({ title: 'Delete this question?', text: q.text, confirm: 'Delete', danger: true })) === null) return; try { await api.deleteQuestion(q.id); load(); } catch (e) { notify(err(e), 'bad'); } };
  const roleName = roleId == null ? 'All roles' : departments.find((d) => d.id === roleId)?.name ?? 'Role';
  const showDiff = (qs ?? []).some((x: any) => x.difficulty);   // the Difficulty column only when some question has one
  return (<>
    <div className="rec-tabs">
      <button className={`rec-tab ${role === 'all' ? 'rec-tab--on' : ''}`} onClick={() => setRole('all')}>All roles <span className="rec-count">{count(null)}</span></button>
      {departments.map((d) => <button key={d.id} className={`rec-tab ${role === String(d.id) ? 'rec-tab--on' : ''}`} onClick={() => setRole(String(d.id))}>{d.name} <span className="rec-count">{count(d.id)}</span></button>)}
    </div>
    <div className="rec-filters" style={{ justifyContent: 'space-between' }}>
      <span className="rec-muted">{roleId == null
        ? 'Asked in every role\'s video interview, first.'
        : `A ${roleName} interview asks ${general + count(roleId)} question${general + count(roleId) === 1 ? '' : 's'}: the ${general} for all roles, then these ${count(roleId)}.`}</span>
      <div className="rec-actions">
        <label className="rec-switch" title="Each candidate gets these questions in a random order">
          <input type="checkbox" checked={shuffleOn} onChange={toggleShuffle} /><span /> Shuffle questions
        </label>
        <button className="btn-primary" onClick={() => setEdit({ department_id: roleId, text: '', difficulty: '', active: true })}>Add question to {roleName}</button>
      </div>
    </div>
    {shuffleOn && <p className="rec-muted" style={{ margin: '-6px 0 12px' }}>Shuffle is on: each candidate gets this tab's questions in a random order, so the order below isn't used.</p>}
    {order && (
      <div className="rec-order-bar" role="status">
        <span><b>Order changed, not saved yet.</b> {shown.filter((q, i) => was.get(q.id) !== i).length} question{shown.filter((q, i) => was.get(q.id) !== i).length === 1 ? '' : 's'} moved. Candidates still get the saved order until you save.</span>
        <div className="rec-actions"><button className="btn-secondary" onClick={() => { before.current = new Map([...rowEls.current].map(([k, el]) => [k, el.getBoundingClientRect().top])); movedId.current = null; setOrder(null); }}>Undo changes</button><button className="btn-primary" onClick={saveOrder}>Save order</button></div>
      </div>
    )}
    <div className="rec-card rec-table-wrap">
      <table className={`rec-table ${shuffleOn ? 'rec-q--shuffled' : ''}`}>
        <thead><tr><th style={{ width: 150 }}>Order</th><th>Question</th>{showDiff && <th>Difficulty</th>}<th>Status</th><th /></tr></thead>
        <tbody>{shown.length ? shown.map((q, n) => (
          <tr key={q.id} ref={(el) => { if (el) rowEls.current.set(q.id, el); else rowEls.current.delete(q.id); }}
            className={`${dragId === q.id ? 'rec-q--drag' : ''} ${order && was.get(q.id) !== n ? 'rec-q--changed' : ''}`}
            draggable={!shuffleOn} onDragStart={(e) => { setDragId(q.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(q.id)); }}
            onDragOver={(e) => { if (dragId == null) return; e.preventDefault(); if (dragId !== q.id) place(dragId, n); }}
            onDragEnd={() => setDragId(null)} onDrop={(e) => { e.preventDefault(); setDragId(null); }}>
            <td style={{ whiteSpace: 'nowrap' }}>
              <span className="rec-grip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
              <button className="rec-arrow" aria-label={`Move question ${n + 1} up`} disabled={n === 0 || shuffleOn} onClick={() => move(n, -1)}>↑</button>
              <button className="rec-arrow" aria-label={`Move question ${n + 1} down`} disabled={n === shown.length - 1 || shuffleOn} onClick={() => move(n, 1)}>↓</button>
              <span className="rec-q-num">{n + 1}</span>
              {order && was.get(q.id) !== n && <span className="rec-q-was">was {(was.get(q.id) ?? 0) + 1}</span>}
            </td>
            <td style={{ maxWidth: 520 }}>{q.text}{q.used && <div className="rec-sub">Used in interviews</div>}</td>
            {showDiff && <td>{q.difficulty || '—'}</td>}
            <td><span className={`rec-pill ${q.active ? 'rec-pill--good' : ''}`}>{q.active ? 'Asked' : 'Off'}</span></td>
            <td><div className="rec-actions">
              <button className="rec-linkbtn" onClick={() => setPreview(q)}>Preview</button>
              <button className="rec-linkbtn" onClick={() => setEdit({ ...q, difficulty: q.difficulty ?? '' })}>Edit</button>
              <button className="rec-linkbtn rec-linkbtn--muted" onClick={() => toggle(q)}>{q.active ? 'Turn off' : 'Turn on'}</button>
              {!q.used && <button className="rec-btn-danger" onClick={() => remove(q)}>Delete</button>}
            </div></td>
          </tr>)) : <tr><td colSpan={5} className="rec-empty">No questions for {roleName} yet.</td></tr>}</tbody>
      </table>
    </div>
    {edit && (
      <Modal title={edit.id ? 'Edit question' : `Add question · ${roleName}`} onClose={() => setEdit(null)} dismissible={false}>
        <div className="rec-field"><label>Role</label>
          <select className="form-input" value={edit.department_id ?? ''} onChange={(e) => setEdit({ ...edit, department_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All roles (asked in every interview)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div className="rec-field" style={{ marginTop: 10 }}><label>Question</label><textarea className="form-input" rows={3} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} maxLength={1000} autoFocus /></div>
        <div className="rec-field" style={{ marginTop: 10 }}><label>Difficulty (optional)</label><select className="form-input" value={edit.difficulty} onChange={(e) => setEdit({ ...edit, difficulty: e.target.value })}><option value="">—</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
        {edit.used && <p className="rec-muted">This question was used in interviews; past interviews keep the wording they were asked.</p>}
        <div className="rec-actions" style={{ marginTop: 12 }}><button className="btn-primary" onClick={save}>Save</button><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button></div>
      </Modal>
    )}
    {preview && (
      <Modal title="Question preview" onClose={() => setPreview(null)}>
        <p className="rec-muted" style={{ marginTop: 0 }}>How the candidate sees it</p>
        <p className="iv-question">{preview.text}</p>
      </Modal>
    )}
  </>);
}

function Settings() {
  const [s, setS] = useState<any>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { api.settings().then((r) => setS(r.data)).catch(() => {}); }, []);
  const save = async () => { try { setS((await api.saveSettings(s)).data); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch (e) { notify(err(e), 'bad'); } };
  if (!s) return <div className="rec-empty">Loading…</div>;
  const field = (k: string, label: string, hint: string, min: number, max: number) => (
    <div className="rec-field"><label>{label}</label><input className="form-input" type="number" min={min} max={max} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /><span className="rec-muted">{hint}</span></div>
  );
  return (
    <div className="rec-card rec-card--pad" style={{ maxWidth: 680 }}>
      <h3 className="rec-set-h">Video interview</h3>
      <div className="rec-grid2">
        {field('seconds_per_question', 'Seconds per question', '20 to 900', 20, 900)}
        {field('interview_link_days', 'Interview link valid for (days)', 'After admin approval', 1, 60)}
      </div>
      <h3 className="rec-set-h">Recordings</h3>
      <div className="rec-grid2">
        {field('recording_retention_days', 'Keep recordings for (days)', 'Recordings are deleted after this', 7, 3650)}
      </div>
      <h3 className="rec-set-h">Integrity rules</h3>
      <div className="rec-grid2">
        {field('max_warnings', 'Interview warnings before a pause', 'One more after this pauses the interview for review (1 to 10)', 1, 10)}
        {field('warning_away_seconds', 'Time away from the page that counts (s)', 'Shorter absences are logged, not warned (3 to 600)', 3, 600)}
        <div className="rec-field"><label>Fullscreen required</label><select className="form-input" value={String(s.fullscreen_required)} onChange={(e) => setS({ ...s, fullscreen_required: Number(e.target.value) })}><option value="0">No (leaving it is only logged)</option><option value="1">Yes (leaving it gives a warning)</option></select></div>
        <div className="rec-field"><label>Serious incidents</label><select className="form-input" value={String(s.pause_on_serious)} onChange={(e) => setS({ ...s, pause_on_serious: Number(e.target.value) })}><option value="1">Pause the interview at once for review</option><option value="0">Warn only, flag for review</option></select><span className="rec-muted">E.g. the interview open on two devices at the same time</span></div>
      </div>
      <div className="rec-actions" style={{ marginTop: 14 }}><button className="btn-primary" onClick={save}>Save settings</button>{saved && <span className="rec-muted">Saved</span>}</div>
    </div>
  );
}
