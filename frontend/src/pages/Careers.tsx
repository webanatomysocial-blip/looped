// Public careers pages: open jobs, a job with its application form, and the candidate's tracking page.
// No Loop login: candidates reach their own application only through the private link they get when applying.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { careersApi } from '../services/api';
import '../css/pages/Recruitment.css';

export function CareersShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers">
      <header className="careers-top"><img src="/fav.png" alt="" /><b>Loooped Careers</b></header>
      <main className="careers-main">{children}</main>
    </div>
  );
}
const err = (e: any, fallback = 'Something went wrong. Please try again.') => e?.response?.data?.error || fallback;

export default function Careers() {
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [q, setQ] = useState(''); const [dept, setDept] = useState(''); const [type, setType] = useState('');
  useEffect(() => { careersApi.jobs().then((r) => setJobs(r.data)).catch(() => setJobs([])); }, []);
  const depts = useMemo(() => [...new Set((jobs ?? []).map((j) => j.department).filter(Boolean))].sort(), [jobs]);
  const types = useMemo(() => [...new Set((jobs ?? []).map((j) => j.employment_type).filter(Boolean))].sort(), [jobs]);
  const shown = (jobs ?? []).filter((j) => (!dept || j.department === dept) && (!type || j.employment_type === type)
    && (!q || `${j.title} ${j.department ?? ''} ${j.location ?? ''} ${j.skills ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <CareersShell>
      <div className="careers-hero"><h1>Join our team</h1><p>Explore open positions and apply in a few minutes.</p></div>
      <div className="rec-filters">
        <input className="form-input" placeholder="Search jobs, skills, location" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="form-input" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        {types.length > 0 && <select className="form-input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{types.map((d) => <option key={d}>{d}</option>)}</select>}
      </div>
      {jobs === null ? <div className="rec-empty">Loading…</div> : shown.length === 0 ? <div className="rec-empty">{jobs.length ? 'No jobs match your search.' : 'There are no open positions right now. Please check back soon.'}</div> : (
        <div className="careers-list">
          {shown.map((j) => (
            <div key={j.id} className="rec-card careers-job">
              <h2>{j.title}</h2>
              <div className="careers-meta">
                {j.department && <span className="rec-pill rec-pill--info">{j.department}</span>}
                {j.location && <span className="rec-pill">{j.location}</span>}
                {j.employment_type && <span className="rec-pill">{j.employment_type}</span>}
                {j.experience && <span className="rec-pill">{j.experience}</span>}
              </div>
              <p className="rec-muted" style={{ margin: 0, fontSize: 13 }}>{String(j.description ?? '').slice(0, 160)}{String(j.description ?? '').length > 160 ? '…' : ''}</p>
              <div><Link to={`/careers/${j.id}`} className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex' }}>View &amp; apply</Link></div>
            </div>
          ))}
        </div>
      )}
    </CareersShell>
  );
}

export function CareerJob() {
  const { id } = useParams();
  const nav = useNavigate();
  const [job, setJob] = useState<any>(null); const [missing, setMissing] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ name: '', email: '', phone: '', location: '', education: '', experience_years: '', company: '', skills: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { careersApi.job(id!).then((r) => setJob(r.data)).catch(() => setMissing(true)); }, [id]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!file) { setError('Please attach your resume'); return; }
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setError('Resume must be a PDF, DOC or DOCX file'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Resume must be 5 MB or smaller'); return; }
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.append(k, v);
    form.append('website', (document.getElementById('rec-hp') as HTMLInputElement)?.value ?? '');
    form.append('resume', file);
    setBusy(true);
    try {
      const r = await careersApi.apply(id!, form);
      nav(`/careers/track/${r.data.token}`, { state: { justApplied: r.data.ref } });
    } catch (e2) { setError(err(e2)); } finally { setBusy(false); }
  };
  if (missing) return <CareersShell><div className="rec-empty">This job is no longer open. <Link to="/careers">See all open jobs</Link></div></CareersShell>;
  if (!job) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  const block = (title: string, text?: string) => text ? <div className="rec-section"><h3>{title}</h3><p className="careers-text">{text}</p></div> : null;
  return (
    <CareersShell>
      <p><Link to="/careers" className="rec-muted">← All jobs</Link></p>
      <div className="rec-card rec-card--pad" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--ink)' }}>{job.title}</h1>
        <div className="careers-meta">
          {job.department && <span className="rec-pill rec-pill--info">{job.department}</span>}
          {job.location && <span className="rec-pill">{job.location}</span>}
          {job.employment_type && <span className="rec-pill">{job.employment_type}</span>}
          {job.experience && <span className="rec-pill">{job.experience}</span>}
          <span className="rec-pill">{job.vacancies} opening{job.vacancies > 1 ? 's' : ''}</span>
          {job.deadline && <span className="rec-pill rec-pill--warn">Apply by {job.deadline}</span>}
        </div>
        {block('About the role', job.description)}{block('Responsibilities', job.responsibilities)}{block('Qualifications', job.qualifications)}{block('Skills', job.skills)}
      </div>
      <form className="rec-card rec-card--pad" onSubmit={submit}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, color: 'var(--ink)' }}>Apply for this job</h2>
        <div className="rec-grid2">
          <div className="rec-field"><label>Full name *</label><input className="form-input" required maxLength={120} value={f.name} onChange={set('name')} /></div>
          <div className="rec-field"><label>Email *</label><input className="form-input" type="email" required maxLength={190} value={f.email} onChange={set('email')} /></div>
          <div className="rec-field"><label>Phone *</label><input className="form-input" type="tel" required maxLength={20} value={f.phone} onChange={set('phone')} /></div>
          <div className="rec-field"><label>Current location</label><input className="form-input" maxLength={120} value={f.location} onChange={set('location')} /></div>
          <div className="rec-field"><label>Highest qualification</label><input className="form-input" maxLength={200} value={f.education} onChange={set('education')} /></div>
          <div className="rec-field"><label>Total experience (years) *</label><input className="form-input" type="number" min="0" max="60" step="0.5" required value={f.experience_years} onChange={set('experience_years')} /></div>
          <div className="rec-field"><label>Current / previous company</label><input className="form-input" maxLength={160} value={f.company} onChange={set('company')} /></div>
          <div className="rec-field"><label>Resume * (PDF, DOC, DOCX · max 5 MB)</label><input className="form-input" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <div className="rec-field rec-field--full"><label>Relevant skills</label><textarea className="form-input" rows={3} maxLength={2000} value={f.skills} onChange={set('skills')} /></div>
          {/* left empty by people; filled by bots */}
          <input id="rec-hp" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} aria-hidden="true" />
        </div>
        {error && <p className="rec-error" role="alert">{error}</p>}
        <p className="rec-muted">Your details are used only for this recruitment process.</p>
        <button className="btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
      </form>
    </CareersShell>
  );
}

const STEPS = [
  ['applied', 'Applied'], ['under_review', 'Under review'], ['prelim_pending', 'Preliminary interview'], ['interview_review', 'Interview review'],
  ['prelim_approved', 'Interview approved'], ['final_scheduled', 'Final interview scheduled'], ['final_completed', 'Final interview completed'], ['selected', 'Selected'],
];
export function CareerTrack() {
  const { token } = useParams();
  const nav = useNavigate();
  const justApplied = (window.history.state?.usr as any)?.justApplied as string | undefined;
  const [a, setA] = useState<any>(null); const [error, setError] = useState('');
  const load = () => careersApi.track(token!).then((r) => setA(r.data)).catch((e) => setError(err(e)));
  useEffect(() => { load(); }, [token]);
  const startInterview = async () => {
    try { const r = await careersApi.interviewLink(token!); nav(`/careers/interview/${r.data.token}`); } catch (e) { alert(err(e)); }
  };
  const withdraw = async () => {
    if (!confirm('Withdraw your application? This cannot be undone.')) return;
    try { setA((await careersApi.withdraw(token!)).data); } catch (e) { alert(err(e)); }
  };
  if (error) return <CareersShell><div className="rec-empty">{error}</div></CareersShell>;
  if (!a) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  const idx = STEPS.findIndex(([k]) => k === a.status_key);
  const closed = ['rejected', 'withdrawn'].includes(a.status_key);
  return (
    <CareersShell>
      {justApplied && (
        <div className="rec-card rec-card--pad" style={{ marginBottom: 14, borderColor: 'rgba(76,175,125,0.4)' }}>
          <b>Application submitted.</b> Your reference is <b>{justApplied}</b>.
          <p className="rec-muted" style={{ margin: '6px 0 0' }}>Bookmark this page: it is your private link to check your status. Don't share it.</p>
        </div>
      )}
      <div className="rec-card rec-card--pad">
        <p className="rec-muted" style={{ margin: 0 }}>Reference {a.ref}</p>
        <h1 style={{ margin: '4px 0 2px', fontSize: 22, color: 'var(--ink)' }}>{a.job}</h1>
        <p className="rec-muted" style={{ marginTop: 0 }}>{a.name}{a.job_location ? ` · ${a.job_location}` : ''}</p>
        <p style={{ fontSize: 15 }}>Status: <span className={`rec-pill ${a.status_key === 'selected' ? 'rec-pill--good' : closed ? 'rec-pill--bad' : 'rec-pill--info'}`}>{a.status}</span></p>
        {a.status_key === 'rejected' && <p className="careers-text">Thank you for your interest. After careful consideration, we will not be moving forward with your application at this time. We encourage you to apply for future openings.</p>}
        {!closed && (
          <ul className="careers-steps" style={{ margin: '14px 0' }}>
            {STEPS.map(([k, label], i) => <li key={k} className={i <= idx ? 'on' : ''}><i />{label}</li>)}
          </ul>
        )}
        {a.interview && (
          <div className="rec-section">
            <h3>Preliminary interview</h3>
            {a.interview.open ? (<>
              <p className="careers-text">You have been shortlisted. Complete a short recorded video interview (camera and microphone needed). Available until {new Date(a.interview.expires_at).toLocaleDateString()}.</p>
              <div><button className="btn-primary" onClick={startInterview}>Start interview</button></div>
            </>) : <p className="careers-text">The interview link has expired. Please contact us if you still wish to continue.</p>}
          </div>
        )}
        {a.schedule && (
          <div className="rec-section">
            <h3>Final interview</h3>
            <dl className="rec-kv">
              <dt>Type</dt><dd>{a.schedule.type === 'online' ? 'Online (one-to-one)' : 'Walk-in'}</dd>
              <dt>Date</dt><dd>{a.schedule.date}</dd>
              <dt>Time</dt><dd>{a.schedule.start_time} – {a.schedule.end_time} IST</dd>
              {a.schedule.type === 'online' ? <><dt>Meeting link</dt><dd><a href={a.schedule.meeting_url} target="_blank" rel="noopener noreferrer">{a.schedule.meeting_url}</a></dd></>
                : <><dt>Location</dt><dd>{a.schedule.location}</dd><dt>Address</dt><dd className="careers-text">{a.schedule.address}</dd></>}
              {a.schedule.instructions && <><dt>Instructions</dt><dd className="careers-text">{a.schedule.instructions}</dd></>}
            </dl>
          </div>
        )}
        {a.can_withdraw && <div className="rec-section"><div><button className="rec-btn-danger" onClick={withdraw}>Withdraw application</button></div></div>}
      </div>
    </CareersShell>
  );
}
