// Public careers pages: open jobs, a job with its application form, and the candidate's tracking page.
// No Loop login: candidates reach their own application only through the private link they get when applying.
// The flow: apply → the short video interview straight away → our review → final interview → shortlisted.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { careersApi } from '../services/api';
import '../css/pages/Recruitment.css';
import { msg } from './CareerInterview';

export function CareersShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="careers">
      <header className="careers-bar">
        <div className="careers-bar__in">
          <Link to="/careers" className="careers-brand"><img src="/fav.png" alt="" /><span>Loooped <b>Careers</b></span></Link>
        </div>
      </header>
      <main className={`careers-main ${wide ? 'careers-main--wide' : ''}`}>{children}</main>
      <footer className="careers-foot">© Loooped · Your details are used only for this recruitment process.</footer>
    </div>
  );
}
// A page a candidate can't use (bad or old link, closed job): say so plainly and give a way forward
export function CareersProblem({ text }: { text: string }) {
  return (
    <CareersShell>
      <div className="rec-card careers-problem">
        <h1>Something needs attention</h1>
        <p className="careers-text">{text}</p>
        <Link className="btn-primary" to="/careers">See open jobs</Link>
        <p className="rec-muted">Need help? Email <a href="mailto:webanatomysocial@gmail.com">webanatomysocial@gmail.com</a></p>
      </div>
    </CareersShell>
  );
}
// Day-month-year everywhere (e.g. 09-01-2027); a plain yyyy-mm-dd date is rearranged, not shifted by time zone
export const fmtDay = (d: string | Date) => {
  const m = typeof d === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const x = new Date(d); const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}-${p(x.getMonth() + 1)}-${x.getFullYear()}`;
};
const err = (e: any, fallback?: string) => (e?.response?.data?.error || fallback || msg(e));
// Tags without repeats: no role tag when it is the job title, no "Internship" twice
const Pills = ({ j }: { j: any }) => {
  const seen = new Set<string>([String(j.title ?? '').toLowerCase()]);
  const tags = [[j.department, 'info'], [j.location && j.location, ''], [j.employment_type, ''], [j.experience, '']]
    .filter(([v]) => { const k = String(v ?? '').toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; });
  return <div className="careers-meta">{tags.map(([v, t]) => <span key={v} className={`rec-pill ${t ? `rec-pill--${t}` : ''}`}>{v}</span>)}</div>;
};
export const slugify = (t: string) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const HOW = [['1', 'Apply', 'A short form and your resume.'], ['2', 'Video interview', 'A few questions, recorded right after you apply.'], ['3', 'Final interview', 'One-to-one, walk-in or online.']];

export default function Careers() {
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [q, setQ] = useState(''); const [dept, setDept] = useState(''); const [type, setType] = useState('');
  useEffect(() => { careersApi.jobs().then((r) => setJobs(r.data)).catch(() => setJobs([])); }, []);
  const depts = useMemo(() => [...new Set((jobs ?? []).map((j) => j.department).filter(Boolean))].sort(), [jobs]);
  const types = useMemo(() => [...new Set((jobs ?? []).map((j) => j.employment_type).filter(Boolean))].sort(), [jobs]);
  const shown = (jobs ?? []).filter((j) => (!dept || j.department === dept) && (!type || j.employment_type === type)
    && (!q || `${j.title} ${j.department ?? ''} ${j.location ?? ''} ${j.skills ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <CareersShell wide>
      <section className="careers-hero">
        <h1>Join our team</h1>
        <p>Find a role that fits you and apply in a few minutes.</p>
        <div className="careers-how">{HOW.map(([n, t, d]) => <div key={n}><i>{n}</i><b>{t}</b><span>{d}</span></div>)}</div>
      </section>
      <LostLink />
      <div className="careers-search">
        <input className="form-input" placeholder="Search by role, skill or location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
        <select className="form-input" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        {types.length > 0 && <select className="form-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Job type"><option value="">All types</option>{types.map((d) => <option key={d}>{d}</option>)}</select>}
      </div>
      {jobs === null ? <div className="rec-empty">Loading…</div> : shown.length === 0 ? <div className="rec-empty">{jobs.length ? 'No jobs match your search.' : 'There are no open positions right now. Please check back soon.'}</div> : (<>
        <p className="careers-count">{shown.length} open position{shown.length === 1 ? '' : 's'}</p>
        <div className="careers-list">
          {shown.map((j) => (
            <Link key={j.id} to={`/careers/${j.slug || j.id}`} className="rec-card careers-job">
              <h2>{j.title}</h2>
              <Pills j={j} />
              {j.description && <p className="careers-job__desc">{String(j.description).slice(0, 170)}{String(j.description).length > 170 ? '…' : ''}</p>}
              <span className="careers-job__go">View &amp; apply →</span>
            </Link>
          ))}
        </div>
      </>)}
    </CareersShell>
  );
}

export function CareerJob() {
  const { id } = useParams();
  const nav = useNavigate();
  const [job, setJob] = useState<any>(null); const [missing, setMissing] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ name: '', email: '', phone: '', location: '', education: '', experience_years: '', current_ctc: '', expected_ctc: '', interview_mode: '', company: '', skills: '' });
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
      const r = await careersApi.apply(job.id, form);   // the opening's id (the address may be its readable name)
      // Straight into the video interview; the private tracking link travels with it
      nav(`/careers/interview/${r.data.interview_token}`, { state: { track: r.data.token, ref: r.data.ref } });
    } catch (e2) { setError(err(e2)); } finally { setBusy(false); }
  };
  if (missing) return <CareersProblem text="This job is no longer open." />;
  if (!job) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  const block = (title: string, text?: string) => text ? <section className="careers-block"><h3>{title}</h3><p className="careers-text">{text}</p></section> : null;
  return (
    <CareersShell wide>
      <Link to="/careers" className="careers-back">← All jobs</Link>
      <div className="careers-job-page">
        <article className="rec-card careers-detail">
          <h1>{job.title}</h1>
          <Pills j={job} />
          <p className="careers-sub">{job.vacancies} opening{job.vacancies > 1 ? 's' : ''}{job.deadline ? ` · Apply by ${job.deadline}` : ''}</p>
          {block('About the role', job.description)}{block('Responsibilities', job.responsibilities)}{block('Qualifications', job.qualifications)}{block('Skills', job.skills)}
          <section className="careers-block">
            <h3>How it works</h3>
            <ol className="careers-steps2">
              {HOW.map(([n, t, d]) => <li key={n}><i>{n}</i><div><b>{t}</b><span>{d}</span></div></li>)}
            </ol>
          </section>
        </article>
        <form className="rec-card careers-form" onSubmit={submit}>
          <h2>Apply for this job</h2>
          <p className="careers-note">After you submit, a short <b>video interview</b> starts right away. Keep your camera and microphone ready; each question has a short time limit.</p>
          <div className="careers-fields">
            <div className="rec-field"><label>Full name *</label><input className="form-input" required maxLength={120} value={f.name} onChange={set('name')} autoComplete="name" /></div>
            <div className="rec-field"><label>Email *</label><input className="form-input" type="email" required maxLength={190} value={f.email} onChange={set('email')} autoComplete="email" /></div>
            <div className="rec-field"><label>Phone *</label><input className="form-input" type="tel" required maxLength={20} value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
            <div className="rec-field"><label>Total experience (years) *</label><input className="form-input" type="number" min="0" max="60" step="0.5" required value={f.experience_years} onChange={set('experience_years')} /></div>
            <div className="rec-field"><label>Current CTC *</label><input className="form-input" required maxLength={60} placeholder="e.g. 4.5 LPA" value={f.current_ctc} onChange={set('current_ctc')} /></div>
            <div className="rec-field"><label>Expected CTC *</label><input className="form-input" required maxLength={60} placeholder="e.g. 6 LPA" value={f.expected_ctc} onChange={set('expected_ctc')} /></div>
            <div className="rec-field"><label>Preferred interview mode *</label><select className="form-input" required value={f.interview_mode} onChange={set('interview_mode')}><option value="">Choose…</option><option value="walkin">Walk-in (at our office)</option><option value="online">Online (video call)</option></select></div>
            <div className="rec-field"><label>Current location</label><input className="form-input" maxLength={120} value={f.location} onChange={set('location')} /></div>
            <div className="rec-field"><label>Highest qualification</label><input className="form-input" maxLength={200} value={f.education} onChange={set('education')} /></div>
            <div className="rec-field"><label>Current / previous company</label><input className="form-input" maxLength={160} value={f.company} onChange={set('company')} /></div>
            <div className="rec-field rec-field--full"><label>Relevant skills</label><textarea className="form-input" rows={3} maxLength={2000} value={f.skills} onChange={set('skills')} /></div>
            <div className="rec-field rec-field--full">
              <label>Resume * <span className="rec-muted">PDF, DOC or DOCX · up to 5 MB</span></label>
              <label className={`careers-file ${file ? 'careers-file--on' : ''}`}>
                <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span>{file ? `📎 ${file.name}` : 'Choose a file…'}</span>
              </label>
            </div>
            {/* left empty by people; filled by bots */}
            <input id="rec-hp" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} aria-hidden="true" />
          </div>
          {error && <p className="rec-error" role="alert">{error}</p>}
          <button className="btn-primary careers-submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit & start the video interview'}</button>
          <p className="rec-muted" style={{ margin: 0, fontSize: 12 }}>Your details are used only for this recruitment process.</p>
        </form>
      </div>
    </CareersShell>
  );
}

// What the candidate sees: apply → video interview → our review → final interview → shortlisted
const STEPS: [string, string, string[]][] = [
  ['applied', 'Applied', ['applied', 'under_review', 'admin_review']],
  ['video', 'Video interview', ['prelim_pending']],
  ['review', 'Under review', ['interview_review']],
  ['final', 'Final interview', ['prelim_approved', 'final_scheduled', 'final_completed']],
  ['selected', 'Shortlisted', ['selected']],
];
export function CareerTrack() {
  const { token } = useParams();
  const nav = useNavigate();
  const [a, setA] = useState<any>(null); const [error, setError] = useState('');
  const load = () => careersApi.track(token!).then((r) => setA(r.data)).catch((e) => setError(err(e)));
  useEffect(() => { load(); }, [token]);
  const startInterview = async () => {
    try { const r = await careersApi.interviewLink(token!); nav(`/careers/interview/${r.data.token}`, { state: { track: token, ref: a?.ref } }); } catch (e) { alert(err(e)); }
  };
  const withdraw = async () => {
    if (!confirm('Withdraw your application?\n\nPlease note: after withdrawing, you cannot apply for this role again for the next 3 months. This cannot be undone.\n\nFor any issue, contact webanatomysocial@gmail.com.')) return;
    try { setA((await careersApi.withdraw(token!)).data); } catch (e) { alert(err(e)); }
  };
  if (error) return <CareersProblem text={error} />;
  if (!a) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  const closed = ['rejected', 'withdrawn'].includes(a.status_key);
  const idx = STEPS.findIndex(([, , keys]) => keys.includes(a.status_key));
  return (
    <CareersShell>
      <div className="rec-card careers-detail">
        <p className="rec-muted" style={{ margin: 0 }}>Reference {a.ref}</p>
        <h1>{a.job}</h1>
        <p className="rec-muted" style={{ marginTop: 0 }}>{a.name}{a.job_location ? ` · ${a.job_location}` : ''}</p>
        <p style={{ fontSize: 15, margin: '6px 0 0' }}>Status: <span className={`rec-pill ${a.status_key === 'selected' ? 'rec-pill--good' : closed ? 'rec-pill--bad' : 'rec-pill--info'}`}>{a.status}</span></p>
        {a.status_key === 'rejected' && <p className="careers-text" style={{ marginTop: 12 }}>Thank you for your interest. After careful consideration, we will not be moving forward with your application at this time. We encourage you to apply for future openings.</p>}
        {!closed && (
          <ol className="careers-track">
            {STEPS.map(([k, label], i) => <li key={k} className={i < idx ? 'done' : i === idx ? 'now' : ''}><i>{i < idx ? '✓' : i + 1}</i><span>{label}</span></li>)}
          </ol>
        )}
        {a.interview && (
          <section className="careers-block">
            <h3>Video interview</h3>
            {a.interview.open ? (<>
              <p className="careers-text">Please complete your short recorded video interview (camera and microphone needed). Available until {fmtDay(a.interview.expires_at)}.</p>
              <button className="btn-primary" onClick={startInterview}>Take the video interview</button>
            </>) : <p className="careers-text">The interview link has expired. Please contact us if you still wish to continue.</p>}
          </section>
        )}
        {a.schedule && (
          <section className="careers-block">
            <h3>Final interview</h3>
            <dl className="rec-kv">
              <dt>Type</dt><dd>{a.schedule.type === 'online' ? 'Online (one-to-one)' : 'Walk-in'}</dd>
              <dt>Date</dt><dd>{fmtDay(a.schedule.date)}</dd>
              <dt>Time</dt><dd>{a.schedule.start_time} – {a.schedule.end_time} IST</dd>
              {a.schedule.type === 'online' ? <><dt>Meeting link</dt><dd><a href={a.schedule.meeting_url} target="_blank" rel="noopener noreferrer">{a.schedule.meeting_url}</a></dd></>
                : <><dt>Location</dt><dd>{a.schedule.location}</dd><dt>Address</dt><dd className="careers-text">{a.schedule.address}</dd></>}
              {a.schedule.instructions && <><dt>Instructions</dt><dd className="careers-text">{a.schedule.instructions}</dd></>}
            </dl>
          </section>
        )}
        {a.can_withdraw && <section className="careers-block"><button className="rec-btn-danger" onClick={withdraw}>Withdraw application</button></section>}
      </div>
    </CareersShell>
  );
}

// The candidate's own request to move the final interview (link in the interview email). The team approves or sets another time.
export function CareerReschedule() {
  const { token } = useParams();
  const [v, setV] = useState<any>(null); const [error, setError] = useState('');
  const [f, setF] = useState({ date: '', start_time: '', type: '', reason: '' }); const [busy, setBusy] = useState(false);
  useEffect(() => { careersApi.rescheduleView(token!).then((r) => { setV(r.data); setF((x) => ({ ...x, type: r.data.current.type })); }).catch((e) => setError(err(e))); }, [token]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const today = new Date().toISOString().slice(0, 10);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { setV((await careersApi.requestReschedule(token!, f)).data); } catch (x) { alert(err(x)); } finally { setBusy(false); }
  };
  if (error) return <CareersProblem text={error} />;
  if (!v) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  return (
    <CareersShell>
      <div className="rec-card careers-detail">
        <p className="rec-muted" style={{ margin: 0 }}>Reference {v.ref}</p>
        <h1>Reschedule your final interview</h1>
        <p className="careers-text">{v.name}, your interview for <b>{v.job}</b> is now {v.current.type === 'online' ? 'online' : 'a walk-in'} on <b>{fmtDay(v.current.date)}</b>, {v.current.start_time} – {v.current.end_time} IST.</p>
        {v.pending ? (
          <section className="careers-block">
            <h3>Request sent</h3>
            <p className="careers-text">You asked for {v.pending.type === 'online' ? 'online' : 'walk-in'} on {fmtDay(v.pending.date)} at {v.pending.start_time} IST. Our team will review it and email you the confirmed time. Until then, your current time stays.</p>
          </section>
        ) : (
          <form className="careers-block" onSubmit={submit}>
            <div className="rec-field"><label>Preferred new date *</label><input className="form-input" type="date" required min={today} value={f.date} onChange={set('date')} /></div>
            <div className="rec-field"><label>Preferred time (IST) *</label><input className="form-input" type="time" required value={f.start_time} onChange={set('start_time')} /></div>
            <div className="rec-field"><label>Interview mode *</label>
              <select className="form-input" required value={f.type} onChange={set('type')}><option value="walkin">Walk-in (at our office)</option><option value="online">Online</option></select></div>
            <div className="rec-field"><label>Reason for rescheduling *</label><textarea className="form-input" required maxLength={1000} rows={3} value={f.reason} onChange={set('reason')} /></div>
            <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </form>
        )}
      </div>
    </CareersShell>
  );
}

// Applied but did not take the video interview, and lost the email: the link is re-sent to the applicant's inbox
function LostLink() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { setDone((await careersApi.resendInterviewLink(email)).data.message); } catch (x) { alert(err(x)); } finally { setBusy(false); }
  };
  return (
    <details className="rec-card" style={{ margin: '16px 0', padding: '12px 16px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Already applied? Lost your video interview link?</summary>
      {done ? <p className="careers-text">{done}</p> : (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input className="form-input" type="email" required placeholder="The email you applied with" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: '1 1 240px' }} aria-label="Email you applied with" />
          <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Email me the link'}</button>
        </form>
      )}
    </details>
  );
}
