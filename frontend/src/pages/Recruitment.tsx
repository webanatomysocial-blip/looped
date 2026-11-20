// Recruitment dashboard for admins and managers: overview, job openings, applications (review, interview, evaluation,
// scheduling), the common HR question bank and settings. What each person may approve is decided by the server;
// the buttons shown follow its answer ("can").
import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout/Layout';
import Modal from '../components/UI/Modal';
import Drawer from '../components/UI/Drawer';
import { recruitmentApi as api } from '../services/api';
import { slugify } from './Careers';
import { useAuth } from '../contexts/AuthContext';
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
function FinalVideo({ url, refresh }: { url: string; refresh: () => void }) {
  const retried = useRef(false);
  return <video key={url} className="rec-video" controls preload="metadata" src={url} onError={() => { if (!retried.current) { retried.current = true; refresh(); } }} />;
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
const QUEUES: [string, string, string][] = [
  ['Video interview pending', 'prelim_pending', 'prelim_pending'], ['Manager review', 'interview_review,applied,under_review', 'awaiting_evaluation'],
  ['Admin review', 'interview_admin_review,admin_review', 'awaiting_admin'],
  ['Final interview to schedule', 'prelim_approved', ''], ['Final scheduled', 'final_scheduled', 'final_scheduled'], ['Final done · decide', 'final_completed', ''],
  ['Shortlisted', 'selected', 'selected'], ['Rejected', 'rejected', 'rejected'],
];

export default function Recruitment() {
  const [tab, setTab] = useState<Tab>('overview');
  const [queue, setQueue] = useState('');
  const [departments, setDepartments] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const loadRefs = () => { api.departments().then((r) => setDepartments(r.data)).catch(() => {}); api.jobs().then((r) => setJobs(r.data)).catch(() => {}); };
  useEffect(loadRefs, []);
  const { user } = useAuth();
  // Recruitment-wide settings are admin-only (the server enforces it too)
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['openings', 'Job Openings'], ['applications', 'Applications'], ['questions', 'Question Bank'], ...(user?.role === 'admin' ? [['settings', 'Settings'] as [Tab, string]] : [])];
  return (
    <Layout>
      <div className="rec-page">
        <div className="rec-head">
          <div><h1>Recruitment</h1><p>Openings, applications, interviews and hiring decisions</p></div>
          <a className="btn-secondary" href="/careers" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Open careers page ↗</a>
        </div>
        <div className="rec-tabs">{tabs.map(([k, l]) => <button key={k} className={`rec-tab ${tab === k ? 'rec-tab--on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'overview' && <Overview jobs={jobs} departments={departments} open={(q) => { setQueue(q); setTab('applications'); }} />}
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

function Overview({ jobs, departments, open }: { jobs: any[]; departments: any[]; open: (q: string) => void }) {
  const [f, setF] = useState<any>({}); const [o, setO] = useState<any>(null);
  useEffect(() => { api.overview(f).then((r) => setO(r.data)).catch(() => setO(null)); }, [JSON.stringify(f)]);
  if (!o) return <div className="rec-empty">Loading…</div>;
  const m: [string, number, string?][] = [
    ['Job openings', o.jobs_total], ['Active openings', o.jobs_active], ['Applications', o.applications_total],
    ['Video interviews pending', o.prelim_pending, 'prelim_pending'], ['Awaiting manager review', o.awaiting_manager, 'interview_review,applied,under_review'],
    ['Awaiting admin decision', o.awaiting_admin, 'interview_admin_review,admin_review'], ['Final interview to schedule', o.to_schedule, 'prelim_approved'],
    ['Final interviews scheduled', o.final_scheduled, 'final_scheduled'], ['Shortlisted', o.selected, 'selected'], ['Rejected', o.rejected, 'rejected'],
  ];
  return (<>
    <Filters jobs={jobs} departments={departments} f={f} setF={setF} />
    <div className="rec-metrics">
      {m.map(([label, n, q]) => (
        <button key={label} className="rec-card rec-metric" style={{ textAlign: 'left', cursor: q ? 'pointer' : 'default', font: 'inherit' }} onClick={() => q && open(q)}>
          <b>{n}</b><span>{label}</span>
        </button>
      ))}
    </div>
    <div className="rec-card rec-table-wrap">
      <table className="rec-table">
        <thead><tr><th>Opening</th><th>Department</th><th>Status</th><th>Applications</th><th>Selected</th><th>Rejected</th></tr></thead>
        <tbody>{o.per_job.length ? o.per_job.map((j: any) => <tr key={j.id}><td>{j.title}</td><td>{j.department ?? '—'}</td><td><span className="rec-pill">{j.status}</span></td><td>{j.applications}</td><td>{j.selected}</td><td>{j.rejected}</td></tr>)
          : <tr><td colSpan={6} className="rec-muted">No job openings yet.</td></tr>}</tbody>
      </table>
    </div>
  </>);
}

// ── Job openings ──
const EMPTY_JOB = { title: '', category_id: '', description: '', responsibilities: '', qualifications: '', skills: '', experience: '', employment_type: 'Full-time', location: '', vacancies: 1, deadline: '', status: 'draft' };
function Openings({ jobs, departments, reload }: { jobs: any[]; departments: any[]; reload: () => void }) {
  const [edit, setEdit] = useState<any>(null);
  const setStatus = async (j: any, status: string) => { try { await api.updateJob(j.id, { status }); reload(); } catch (e) { alert(err(e)); } };
  const remove = async (j: any) => { if (!confirm(`Delete "${j.title}"?`)) return; try { await api.deleteJob(j.id); reload(); } catch (e) { alert(err(e)); } };
  return (<>
    <div className="rec-actions" style={{ marginBottom: 14 }}><button className="btn-primary" onClick={() => setEdit({ ...EMPTY_JOB })}>+ New job opening</button></div>
    <div className="rec-card rec-table-wrap">
      <table className="rec-table">
        <thead><tr><th>Title</th><th>Role</th><th>Questions</th><th>Location</th><th>Vacancies</th><th>Deadline</th><th>Applications</th><th>Status</th><th /></tr></thead>
        <tbody>{jobs.length ? jobs.map((j) => (
          <tr key={j.id}>
            <td><b>{j.title}</b><div className="rec-sub">{j.employment_type} · {j.experience || 'Any experience'} · by {j.created_by_name ?? '—'}</div></td>
            <td>{j.department ?? '—'}</td>
            <td>{Number(j.question_count) ? Number(j.question_count) : <span className="rec-pill rec-pill--warn" title="Add questions for this role in the Question Bank before publishing">None yet</span>}</td>
            <td>{j.location || '—'}</td><td>{j.vacancies}</td><td>{j.deadline ? String(j.deadline).slice(0, 10) : '—'}</td><td>{Number(j.applications)}</td>
            <td><span className={`rec-pill ${j.status === 'published' ? 'rec-pill--good' : j.status === 'closed' ? 'rec-pill--bad' : ''}`}>{j.status}</span></td>
            <td><div className="rec-actions">
              <button className="btn-secondary" onClick={() => setEdit({ ...EMPTY_JOB, ...j, category_id: j.category_id ?? '', deadline: j.deadline ? String(j.deadline).slice(0, 10) : '' })}>Edit</button>
              {j.status !== 'published' && <button className="btn-secondary" onClick={() => setStatus(j, 'published')}>Publish</button>}
              {j.status === 'published' && <button className="btn-secondary" title="The role's own page, for LinkedIn and Instagram posts" onClick={() => { const url = `${window.location.origin}/careers/${slugify(j.title)}`; navigator.clipboard?.writeText(url).then(() => alert(`Copied: ${url}`)).catch(() => prompt('Copy this link', url)); }}>Copy link</button>}
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
    <Modal title={job.id ? 'Edit job opening' : 'New job opening'} onClose={onClose} size="lg">
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
      <div className="rec-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button><button className="btn-secondary" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

// ── Applications ──
function Applications({ jobs, departments, queue, setQueue }: { jobs: any[]; departments: any[]; queue: string; setQueue: (q: string) => void }) {
  const [f, setF] = useState<any>({}); const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[] | null>(null); const [open, setOpen] = useState<number | null>(null);
  const isAdmin = useAuth().user?.role === 'admin';
  const [picked, setPicked] = useState<Set<number>>(new Set()); const [deleting, setDeleting] = useState(false);
  const load = () => api.applications({ ...f, status: queue || undefined, search: search || undefined }).then((r) => { setRows(r.data); setPicked(new Set()); }).catch(() => setRows([]));
  const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
  const total = (rows ?? []).reduce((n, r) => n + Number(r.storage_bytes || 0), 0);
  const pickedBytes = (rows ?? []).filter((r) => picked.has(r.id)).reduce((n, r) => n + Number(r.storage_bytes || 0), 0);
  const toggle = (id: number) => setPicked((p) => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const allOn = !!rows?.length && rows.every((r) => picked.has(r.id));
  // Removes the applicants completely: application, history, scores, interview, resume and recording. Not undoable.
  const removePicked = async () => {
    const n = picked.size;
    if (prompt(`Delete ${n} applicant${n > 1 ? 's' : ''} completely (application, interview, resume and recording, ${mb(pickedBytes)})? This cannot be undone.\n\nType DELETE to confirm.`) !== 'DELETE') return;
    setDeleting(true);
    try {
      const r = await api.deleteCandidates([...picked]);
      alert(`Deleted ${r.data.deleted} applicant${r.data.deleted === 1 ? '' : 's'}, freed ${mb(r.data.freed_bytes)}.${r.data.failed.length ? ` ${r.data.failed.length} could not be deleted.` : ''}`);
    } catch (e) { alert(err(e)); } finally { setDeleting(false); load(); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [JSON.stringify(f), queue, search]);
  return (<>
    <div className="rec-tabs">
      <button className={`rec-tab ${!queue ? 'rec-tab--on' : ''}`} onClick={() => setQueue('')}>All</button>
      {QUEUES.map(([l, s]) => <button key={s} className={`rec-tab ${queue === s ? 'rec-tab--on' : ''}`} onClick={() => setQueue(s)}>{l}</button>)}
    </div>
    <Filters jobs={jobs} departments={departments} f={f} setF={setF} extra={<input className="form-input" placeholder="Search name, email, reference" value={search} onChange={(e) => setSearch(e.target.value)} />} />
    <div className="rec-actions" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
      <span className="rec-muted">{rows ? `${rows.length} applicant${rows.length === 1 ? '' : 's'} · ${mb(total)} of storage` : ''}</span>
      {isAdmin && picked.size > 0 && <button className="rec-btn-danger" disabled={deleting} onClick={removePicked}>{deleting ? 'Deleting…' : `Delete selected (${picked.size} · ${mb(pickedBytes)})`}</button>}
    </div>
    <div className="rec-card rec-table-wrap">
      <table className="rec-table">
        <thead><tr>{isAdmin && <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set((rows ?? []).map((r) => r.id)))} /></th>}<th>Candidate</th><th>Opening</th><th>Experience</th><th>Status</th><th>Applied</th><th>Storage</th></tr></thead>
        <tbody>{rows === null ? <tr><td colSpan={7} className="rec-muted">Loading…</td></tr> : rows.length ? rows.map((r) => (
          <tr key={r.id} className="rec-row" onClick={() => setOpen(r.id)}>
            {isAdmin && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>}
            <td><b>{r.name}</b><div className="rec-sub">{r.ref} · {r.email}</div></td>
            <td>{r.job_title}<div className="rec-sub">{r.department ?? ''}</div></td>
            <td>{Number(r.experience_years)} yrs</td>
            <td><span className={`rec-pill rec-pill--${tone(r.status)}`}>{r.status_label}</span></td>
            <td>{dt(r.created_at)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{mb(Number(r.storage_bytes || 0))}</td>
          </tr>)) : <tr><td colSpan={7} className="rec-muted">No applications here.</td></tr>}</tbody>
      </table>
    </div>
    {open && <ApplicationDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
  </>);
}

const EVENT_LABEL: Record<string, string> = {
  interview_started: 'Interview started', interview_submitted: 'Interview submitted', tab_hidden: 'Left the interview tab', tab_visible: 'Returned to the tab',
  window_blur: 'Window lost focus', window_focus: 'Window focused', fullscreen_exit: 'Exited fullscreen', fullscreen_enter: 'Entered fullscreen',
  camera_lost: 'Camera disconnected', microphone_lost: 'Microphone disconnected', recording_interrupted: 'Recording interrupted', device_info: 'Device', session_resumed: 'Came back to the interview (refresh, new tab or reopened browser)', recording_resumed: 'Recording resumed',
  permission_changed: 'Permission changed', copy_attempt: 'Tried to copy', paste_attempt: 'Tried to paste', navigation_attempt: 'Tried to leave the page',
  network_offline: 'Went offline', network_online: 'Back online', page_reload: 'Reloaded / resumed the interview',
};
const NOTABLE = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'camera_lost', 'microphone_lost', 'recording_interrupted', 'copy_attempt', 'paste_attempt', 'navigation_attempt', 'page_reload', 'session_resumed'];

function ApplicationDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [a, setA] = useState<any>(null); const [media, setMedia] = useState<{ status: string | null; final: string | null; parts: any[] } | null>(null);
  const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  const [ev, setEv] = useState<any>({ overall: '', communication: '', confidence: '', observations: '', comments: '' });
  const [sched, setSched] = useState<any>(null);
  const load = async () => {
    const r = await api.application(id); setA(r.data);
    if (r.data.interview && !r.data.interview.recording_deleted_at) await loadMedia(r.data.interview.id);
  };
  const loadMedia = (ivId: number) => api.recordingLinks(ivId).then((x) => setMedia(x.data)).catch(() => setMedia(null));
  useEffect(() => { load().catch((e) => alert(err(e))); }, [id]);
  // While the recording is being built, check again every few seconds: no manual refresh needed
  const processing = a?.interview?.processing_status === 'processing';
  useEffect(() => { if (!processing) return; const t = setInterval(() => load().catch(() => undefined), 4000); return () => clearInterval(t); }, [processing, id]);
  const refresh = async () => { await load(); onChanged(); };
  const decide = async (action: 'approve' | 'reject' | 'reopen') => {
    if (action === 'reject' && !comment.trim()) { alert('Please add a reason for rejecting'); return; }
    setBusy(true);
    try { await api.decide(id, action, comment || undefined); setComment(''); await refresh(); } catch (e) { alert(err(e)); } finally { setBusy(false); }
  };
  const [newLink, setNewLink] = useState('');
  // Deletes the recording's files for good; the application, answers' timings and history stay
  const deleteVideo = async () => {
    if (!a?.interview) return;
    if (prompt('Delete this interview video permanently? It cannot be recovered.\n\nType DELETE to confirm.') !== 'DELETE') return;
    setBusy(true);
    try { const r = await api.deleteRecording(a.interview.id); alert(`Video deleted${r.data.freed_bytes ? `, ${(r.data.freed_bytes / 1048576).toFixed(1)} MB freed` : ''}.`); setMedia(null); await refresh(); }
    catch (e) { alert(err(e)); } finally { setBusy(false); }
  };
  const linkAction = async (mode: 'new' | 'extend') => {
    setBusy(true);
    try { const r = await api.interviewLink(id, mode); setNewLink(r.data.link ?? ''); await refresh(); } catch (e) { alert(err(e)); } finally { setBusy(false); }
  };
  const allowReapply = async () => {
    const reason = prompt('Why may this candidate reapply for this role now? (recorded)');
    if (!reason?.trim()) return;
    setBusy(true);
    try { await api.allowReapply(id, reason.trim()); await refresh(); } catch (e) { alert(err(e)); } finally { setBusy(false); }
  };
  const resume = async (download = false) => { try { const r = await api.resumeLink(id); window.open(r.data.url + (download ? '&download=1' : ''), '_blank', 'noopener'); } catch (e) { alert(err(e)); } };
  const saveEval = async () => { try { await api.evaluate(id, ev); setEv({ overall: '', communication: '', confidence: '', observations: '', comments: '' }); await load(); } catch (e) { alert(err(e)); } };
  const current = useMemo(() => a?.schedules?.find((s: any) => s.status === 'scheduled'), [a]);
  if (!a) return <Drawer title="Application" onClose={onClose}><div className="drawer-body rec-muted">Loading…</div></Drawer>;
  const iv = a.interview;
  const flagged = iv ? iv.events.filter((e: any) => NOTABLE.includes(e.type)).length : 0;
  const nextLabel = a.status === 'final_completed' ? 'Select candidate' : user?.role === 'admin' ? (['applied', 'under_review', 'interview_review'].includes(a.status) ? 'Approve (admin decision)' : 'Approve') : 'Approve (recommend)';
  return (
    <Drawer title={a.name} label={`${a.ref} · ${a.job?.title ?? ''}`} onClose={onClose}>
      <div className="drawer-body" style={{ overflowY: 'auto' }}>
        <p><span className={`rec-pill rec-pill--${tone(a.status)}`}>{a.status_label}</span></p>

        <div className="rec-section"><h3>Candidate</h3>
          <dl className="rec-kv">
            <dt>Email</dt><dd>{a.email}</dd><dt>Phone</dt><dd>{a.phone}</dd><dt>Location</dt><dd>{a.location || '—'}</dd>
            <dt>Qualification</dt><dd>{a.education || '—'}</dd><dt>Experience</dt><dd>{Number(a.experience_years)} years</dd><dt>Company</dt><dd>{a.company || '—'}</dd>
            <dt>Skills</dt><dd className="careers-text">{a.skills || '—'}</dd><dt>Department</dt><dd>{a.job?.department ?? '—'}</dd><dt>Applied</dt><dd>{dt(a.created_at)}</dd>
          </dl>
          <div className="rec-actions"><button className="btn-secondary" onClick={() => resume()}>View resume</button><button className="btn-secondary" onClick={() => resume(true)}>Download</button><span className="rec-muted">{a.resume_name}</span></div>
        </div>

        {(a.can.length > 0) && (
          <div className="rec-section"><h3>Decision</h3>
            <textarea className="form-input" rows={2} placeholder="Comment (required to reject)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="rec-actions">
              {a.can.includes('approve') && <button className="btn-primary" disabled={busy} onClick={() => decide('approve')}>{nextLabel}</button>}
              {a.can.includes('reject') && <button className="rec-btn-danger" disabled={busy} onClick={() => decide('reject')}>Reject</button>}
              {a.can.includes('reopen') && <button className="btn-secondary" disabled={busy} onClick={() => decide('reopen')}>Reopen</button>}
            </div>
            {user?.role === 'manager' && <p className="rec-muted">Your approval goes to an admin for the final decision.</p>}
          </div>
        )}
        {!a.can.length && ['admin_review', 'interview_admin_review', 'final_completed'].includes(a.status) && <p className="rec-muted">Waiting for an admin decision.</p>}
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
        {user?.role === 'admin' && a.status === 'rejected' && !a.reapply_override_at && (
          <div className="rec-section"><h3>Reapplying</h3>
            <p className="rec-muted">This candidate can apply for this role again 3 months after the rejection. An admin can allow it sooner.</p>
            <div className="rec-actions"><button className="btn-secondary" disabled={busy} onClick={allowReapply}>Allow reapplying now…</button></div>
          </div>
        )}

        {iv && (
          <div className="rec-section"><h3>Video interview</h3>
            <dl className="rec-kv">
              <dt>Started</dt><dd>{dt(iv.started_at)}</dd><dt>Submitted</dt><dd>{iv.submitted_at ? dt(iv.submitted_at) : 'Not yet'}</dd>
              <dt>Duration</dt><dd>{iv.duration_sec ? `${Math.floor(iv.duration_sec / 60)}m ${iv.duration_sec % 60}s` : '—'}</dd>
              <dt>Consent</dt><dd>{dt(iv.consent_at)} · {iv.consent_version}</dd>
              <dt>Recording</dt><dd><RecordingStatus iv={iv} /></dd>
            </dl>
            {iv.verification && <Verification v={iv.verification} />}
            {media && !iv.recording_deleted_at && (media.final || media.parts.length > 0) && (
              <div className="rec-actions" style={{ margin: '4px 0 8px' }}>
                {media.final && <a className="btn-secondary" href={`${media.final}&download=1`} download style={{ textDecoration: 'none' }}>⬇ Download video</a>}
                {user?.role === 'admin' && <button className="rec-btn-danger" disabled={busy} onClick={deleteVideo}>Delete video</button>}
              </div>
            )}
            {media && !iv.recording_deleted_at && (media.final
              ? <FinalVideo url={media.final} refresh={() => loadMedia(iv.id)} />
              : media.parts.length > 0 && iv.processing_status !== 'processing' && <><p className="rec-muted">Not a verified recording: the uploaded parts as received.</p><Recording parts={media.parts} /></>)}
            <h3 style={{ marginTop: 8 }}>Activity {flagged > 0 && <span className="rec-pill rec-pill--warn">{flagged} to review</span>}</h3>
            <p className="rec-muted">Browser indicators only: they cannot prove or rule out cheating. Review them with the recording; they never reject anyone automatically.</p>
            <ul className="rec-timeline">{iv.events.map((e: any, i: number) => <li key={i} style={NOTABLE.includes(e.type) ? { borderColor: '#f59e0b' } : undefined}>{EVENT_LABEL[e.type] ?? e.type}{e.position !== null && e.position !== undefined ? ` · Q${e.position + 1}` : ''}{e.detail ? ` · ${e.detail}` : ''}<div className="rec-sub">{dt(e.at)}</div></li>)}</ul>
          </div>
        )}

        {(iv || a.evaluations.length > 0) && (
          <div className="rec-section"><h3>Evaluation</h3>
            {a.evaluations.map((e: any) => (
              <div key={e.id} className="rec-card rec-card--pad" style={{ padding: 12 }}>
                <b>{e.reviewer_name}</b> <span className="rec-muted">· {dt(e.created_at)}</span>
                <div className="rec-sub">Overall {e.overall ?? '—'}/5 · Communication {e.communication ?? '—'}/5 · Confidence {e.confidence ?? '—'}/5</div>
                {e.observations && <p className="careers-text" style={{ fontSize: 13 }}>{e.observations}</p>}{e.comments && <p className="careers-text" style={{ fontSize: 13 }}>{e.comments}</p>}
              </div>
            ))}
            <div className="rec-grid2">
              {[['overall', 'Overall'], ['communication', 'Communication'], ['confidence', 'Confidence / presentation']].map(([k, l]) => (
                <div key={k} className="rec-field"><label>{l}</label><select className="form-input" value={ev[k]} onChange={(e) => setEv({ ...ev, [k]: e.target.value })}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              ))}
              <div className="rec-field rec-field--full"><label>Observations</label><textarea className="form-input" rows={2} value={ev.observations} onChange={(e) => setEv({ ...ev, observations: e.target.value })} /></div>
              <div className="rec-field rec-field--full"><label>Comments</label><textarea className="form-input" rows={2} value={ev.comments} onChange={(e) => setEv({ ...ev, comments: e.target.value })} /></div>
            </div>
            <div><button className="btn-secondary" onClick={saveEval}>Save evaluation</button></div>
          </div>
        )}

        {(a.status === 'prelim_approved' || a.schedules.length > 0) && (
          <div className="rec-section"><h3>Final interview</h3>
            {a.schedules.map((s: any) => (
              <div key={s.id} className="rec-muted" style={{ fontSize: 13 }}>
                <span className={`rec-pill ${s.status === 'scheduled' ? 'rec-pill--info' : s.status === 'cancelled' ? 'rec-pill--bad' : 'rec-pill--good'}`}>{s.status}</span>{' '}
                {s.type === 'online' ? 'Online' : 'Walk-in'} · {s.date} {s.start_time}–{s.end_time}{s.type === 'online' ? ` · ${s.meeting_url}` : ` · ${s.location ?? ''} ${s.address ?? ''}`}
                {s.interviewers.length > 0 && ` · with ${s.interviewers.map((p: any) => p.name).join(', ')}`}
              </div>
            ))}
            <div className="rec-actions">
              {a.status === 'prelim_approved' && <button className="btn-primary" onClick={() => setSched({ type: 'walkin' })}>Schedule final interview</button>}
              {current && <>
                <button className="btn-secondary" onClick={() => setSched({ ...current, interviewer_ids: current.interviewers.map((p: any) => p.id), sid: current.id })}>Reschedule</button>
                <button className="rec-btn-danger" onClick={async () => { const reason = prompt('Reason for cancelling?'); if (!reason) return; try { await api.cancelSchedule(id, current.id, reason); await refresh(); } catch (e) { alert(err(e)); } }}>Cancel</button>
                <button className="btn-secondary" onClick={async () => { try { await api.finalCompleted(id); await refresh(); } catch (e) { alert(err(e)); } }}>Mark interview completed</button>
              </>}
            </div>
          </div>
        )}

        <div className="rec-section"><h3>History</h3>
          <ul className="rec-timeline">{a.history.map((h: any) => (
            <li key={h.id}>
              <b>{h.action.replace(/_/g, ' ')}</b>{h.override ? <span className="rec-override"> · admin override</span> : null}{h.to_status && h.from_status ? ` · ${h.from_status.replace(/_/g, ' ')} → ${h.to_status.replace(/_/g, ' ')}` : ''}
              <div className="rec-sub">{h.actor_name ?? 'Candidate'} ({h.actor_role}) · {dt(h.created_at)}</div>
              {h.comment && <div style={{ fontSize: 12 }}>"{h.comment}"</div>}
            </li>))}</ul>
        </div>

        {user?.role === 'admin' && (
          <div className="rec-section"><h3>Data</h3>
            <div><button className="rec-btn-danger" onClick={async () => { if (!confirm(`Permanently delete all data for ${a.name}, including the resume and recording?`)) return; try { await api.deleteCandidate(id); onChanged(); onClose(); } catch (e) { alert(err(e)); } }}>Delete candidate data</button></div>
          </div>
        )}
      </div>
      {sched && <ScheduleForm appId={id} initial={sched} onClose={() => setSched(null)} onSaved={async () => { setSched(null); await refresh(); }} />}
    </Drawer>
  );
}

function ScheduleForm({ appId, initial, onClose, onSaved }: { appId: number; initial: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ type: 'walkin', date: '', start_time: '10:00', end_time: '11:00', location: '', address: '', meeting_url: '', instructions: '', interviewer_ids: [], ...initial });
  const [staff, setStaff] = useState<any[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.staff().then((r) => setStaff(r.data)).catch(() => {}); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError('');
    try { if (f.sid) await api.reschedule(appId, f.sid, f); else await api.schedule(appId, f); onSaved(); } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={f.sid ? 'Reschedule final interview' : 'Schedule final interview'} onClose={onClose} size="lg">
      <div className="rec-grid2">
        <div className="rec-field rec-field--full"><label>Interview type</label>
          <div className="rec-actions">{[['walkin', 'Walk-in'], ['online', 'Online one-to-one']].map(([k, l]) => <button key={k} type="button" className={`rec-tab ${f.type === k ? 'rec-tab--on' : ''}`} onClick={() => setF({ ...f, type: k })}>{l}</button>)}</div>
        </div>
        <div className="rec-field"><label>Date *</label><input className="form-input" type="date" value={f.date} onChange={set('date')} /></div>
        <div className="rec-grid2"><div className="rec-field"><label>Start *</label><input className="form-input" type="time" value={f.start_time} onChange={set('start_time')} /></div><div className="rec-field"><label>End *</label><input className="form-input" type="time" value={f.end_time} onChange={set('end_time')} /></div></div>
        {f.type === 'walkin' ? (<>
          <div className="rec-field"><label>Office location</label><input className="form-input" value={f.location ?? ''} onChange={set('location')} /></div>
          <div className="rec-field rec-field--full"><label>Address *</label><textarea className="form-input" rows={2} value={f.address ?? ''} onChange={set('address')} /></div>
        </>) : <div className="rec-field rec-field--full"><label>Meeting link * (https://…)</label><input className="form-input" value={f.meeting_url ?? ''} onChange={set('meeting_url')} placeholder="https://meet.google.com/…" /></div>}
        <div className="rec-field rec-field--full"><label>Interviewers</label>
          <select className="form-input" multiple size={5} value={(f.interviewer_ids ?? []).map(String)} onChange={(e) => setF({ ...f, interviewer_ids: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
          </select><span className="rec-muted">Hold Ctrl / ⌘ to pick several.</span>
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
  const load = () => { api.questions().then((r) => setQs(r.data)).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const roleId = role === 'all' ? null : Number(role);
  const inTab = (q: any) => (roleId == null ? q.department_id == null : Number(q.department_id) === roleId);
  const shown = qs.filter(inTab);
  const general = qs.filter((q) => q.department_id == null && q.active).length;
  const count = (id: number | null) => qs.filter((q) => (id == null ? q.department_id == null : Number(q.department_id) === id) && q.active).length;
  const save = async () => { try { if (edit.id) await api.updateQuestion(edit.id, edit); else await api.addQuestion(edit); setEdit(null); load(); } catch (e) { alert(err(e)); } };
  const toggle = async (q: any) => { try { await api.updateQuestion(q.id, { active: !q.active }); load(); } catch (e) { alert(err(e)); } };
  const remove = async (q: any) => { if (!confirm('Delete this question?')) return; try { await api.deleteQuestion(q.id); load(); } catch (e) { alert(err(e)); } };
  const roleName = roleId == null ? 'All roles' : departments.find((d) => d.id === roleId)?.name ?? 'Role';
  return (<>
    <div className="rec-tabs">
      <button className={`rec-tab ${role === 'all' ? 'rec-tab--on' : ''}`} onClick={() => setRole('all')}>All roles <span className="rec-count">{count(null)}</span></button>
      {departments.map((d) => <button key={d.id} className={`rec-tab ${role === String(d.id) ? 'rec-tab--on' : ''}`} onClick={() => setRole(String(d.id))}>{d.name} <span className="rec-count">{count(d.id)}</span></button>)}
    </div>
    <div className="rec-filters" style={{ justifyContent: 'space-between' }}>
      <span className="rec-muted">{roleId == null
        ? 'Asked in every role\'s video interview, first.'
        : `A ${roleName} interview asks ${general + count(roleId)} question${general + count(roleId) === 1 ? '' : 's'}: the ${general} for all roles, then these ${count(roleId)}.`}</span>
      <button className="btn-primary" onClick={() => setEdit({ department_id: roleId, text: '', difficulty: '', active: true })}>+ Add question to {roleName}</button>
    </div>
    <div className="rec-card rec-table-wrap">
      <table className="rec-table">
        <thead><tr><th style={{ width: 36 }}>#</th><th>Question</th><th>Difficulty</th><th>Status</th><th /></tr></thead>
        <tbody>{shown.length ? shown.map((q, n) => (
          <tr key={q.id}>
            <td className="rec-muted">{n + 1}</td>
            <td style={{ maxWidth: 520 }}>{q.text}{q.used && <div className="rec-sub">Used in interviews</div>}</td>
            <td>{q.difficulty || '—'}</td>
            <td><span className={`rec-pill ${q.active ? 'rec-pill--good' : ''}`}>{q.active ? 'Asked' : 'Off'}</span></td>
            <td><div className="rec-actions">
              <button className="btn-secondary" onClick={() => setPreview(q)}>Preview</button>
              <button className="btn-secondary" onClick={() => setEdit({ ...q, difficulty: q.difficulty ?? '' })}>Edit</button>
              <button className="btn-secondary" onClick={() => toggle(q)}>{q.active ? 'Turn off' : 'Turn on'}</button>
              {!q.used && <button className="rec-btn-danger" onClick={() => remove(q)}>Delete</button>}
            </div></td>
          </tr>)) : <tr><td colSpan={5} className="rec-empty">No questions for {roleName} yet.</td></tr>}</tbody>
      </table>
    </div>
    {edit && (
      <Modal title={edit.id ? 'Edit question' : `Add question · ${roleName}`} onClose={() => setEdit(null)}>
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
  const save = async () => { try { setS((await api.saveSettings(s)).data); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch (e) { alert(err(e)); } };
  if (!s) return <div className="rec-empty">Loading…</div>;
  const field = (k: string, label: string, hint: string, min: number, max: number) => (
    <div className="rec-field"><label>{label}</label><input className="form-input" type="number" min={min} max={max} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /><span className="rec-muted">{hint}</span></div>
  );
  return (
    <div className="rec-card rec-card--pad" style={{ maxWidth: 640 }}>
      <div className="rec-grid2">

        {field('seconds_per_question', 'Seconds per question', '20 to 900', 20, 900)}
        {field('interview_link_days', 'Interview link valid for (days)', 'After admin approval', 1, 60)}
        {field('recording_retention_days', 'Keep recordings for (days)', 'Recordings are deleted after this', 7, 3650)}
      </div>
      <div className="rec-actions" style={{ marginTop: 14 }}><button className="btn-primary" onClick={save}>Save settings</button>{saved && <span className="rec-muted">Saved</span>}</div>
    </div>
  );
}
