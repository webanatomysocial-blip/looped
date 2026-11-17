import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import { assistantAdminApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { MessageCircle, Users, UserX, Clock, Activity, Cpu, CalendarDays, CalendarRange, RefreshCw, Link2, AlertTriangle, Bell, CheckCircle2, Search, QrCode, Smartphone } from 'lucide-react';
import '../../css/admin/AssistantControl.css';

type Tab = 'overview' | 'linking' | 'usage' | 'queue' | 'requests' | 'identities' | 'conversations' | 'failures' | 'audit' | 'config';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'linking', label: 'Employee linking' }, { id: 'usage', label: 'AI usage' }, { id: 'queue', label: 'Live queue' }, { id: 'requests', label: 'Requests' },
  { id: 'identities', label: 'Identities' }, { id: 'conversations', label: 'Conversations' }, { id: 'failures', label: 'Failures' },
  { id: 'audit', label: 'Audit' }, { id: 'config', label: 'Configuration' },
];
const STATUSES = ['NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED'];
const label = (s?: string | null) => (s ?? '').replace(/_/g, ' ').toLowerCase();
// MySQL returns times as plain text in UTC ("2026-11-17 07:57:10"); without this they show 5½ hours early in India
const toDate = (s: string | number) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !/[TZ+]/.test(s) ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s));
const when = (s?: string | number | null) => (s ? format(toDate(s), 'd MMM yyyy, HH:mm') : '—');
const errText = (e: any) => e?.response?.data?.error || 'Something went wrong. Please try again.';

export default function AssistantControl() {
  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4000); };

  return (
    <Layout>
      <div className="ac">
        <header className="ac__head">
          <h1 className="page-title">AI Assistant Control Centre</h1>
          <p className="page-subtitle">WhatsApp connection, employee linking, AI usage and assistant activity. Every change made here is recorded in the audit history.</p>
        </header>
        <nav className="filter-bar ac__tabs" role="tablist" aria-label="Assistant control sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`filter-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {notice && <div className="ac__notice" role="status">{notice}</div>}
        {tab === 'overview' && <Overview go={setTab} flash={flash} />}
        {tab === 'linking' && <LinkingTab flash={flash} />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'queue' && <QueueTab />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'identities' && <IdentitiesTab flash={flash} />}
        {tab === 'conversations' && <ConversationsTab />}
        {tab === 'failures' && <FailuresTab flash={flash} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'config' && <ConfigTab flash={flash} />}
      </div>
    </Layout>
  );
}

function useLoader<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(() => {
    setLoading(true); setError(null);
    load().then(setData).catch((e) => setError(errText(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

const Status = ({ state, loading, error }: { state: any; loading: boolean; error: string | null }) =>
  error ? <div className="ac__error" role="alert">{error}</div> : loading && !state ? <div className="ac__muted">Loading…</div> : null;

// ── Shared dashboard pieces ──
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-IN');
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-IN'));
const FEATURE_LABEL: Record<string, string> = { group_question: 'Group productivity questions', intent_classification: 'Intent classification', clarification: 'Clarification', other: 'Other assistant operations' };
const LINK_LABEL: Record<string, string> = { linked: 'Linked', pending: 'Pending', failed: 'Failed', mapping_required: 'Identity mapping required' };
const WA_LABEL: Record<string, string> = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', stopped: 'Stopped', pairing: 'Pairing required' };

function Stat({ icon: Icon, label: text, value, hint, tone }: { icon: any; label: string; value: React.ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="ac-stat">
      <div className={`ac-stat__icon${tone ? ` ac-stat__icon--${tone}` : ''}`}><Icon size={16} /></div>
      <div className="ac-stat__value">{value}</div>
      <div className="ac-stat__label">{text}</div>
      {hint && <div className="ac-stat__hint">{hint}</div>}
    </div>
  );
}
const Badge = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`ac-badge ac-badge--${tone}`}>{children}</span>;
const Panel = ({ title, action, children, wide }: { title: string; action?: React.ReactNode; children: React.ReactNode; wide?: boolean }) => (
  <section className={`ac-panel${wide ? ' ac-panel--wide' : ''}`}>
    <div className="ac-panel__head"><h2>{title}</h2>{action}</div>
    {children}
  </section>
);
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="ac-kv"><span>{k}</span><strong>{v}</strong></div>;

// Stacked input/output bars per day. Pure SVG, scales to the container.
function UsageChart({ daily, metric = 'tokens' }: { daily: { date: string; input: number; output: number; requests: number }[]; metric?: 'tokens' | 'requests' }) {
  const values = daily.map((d) => (metric === 'tokens' ? d.input + d.output : d.requests));
  const max = Math.max(1, ...values);
  const w = 100 / Math.max(1, daily.length);
  return (
    <div className="ac-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={metric === 'tokens' ? 'Daily tokens, input and output' : 'Daily AI requests'}>
        {daily.map((d, i) => {
          const x = i * w + w * 0.15; const bw = w * 0.7;
          if (metric === 'requests') { const h = (d.requests / max) * 38; return <rect key={d.date} x={x} y={40 - h} width={bw} height={h} rx={0.4} className="ac-chart__req"><title>{`${d.date}: ${d.requests} requests`}</title></rect>; }
          const hi = (d.input / max) * 38; const ho = (d.output / max) * 38;
          return (
            <g key={d.date}>
              <rect x={x} y={40 - hi} width={bw} height={hi} className="ac-chart__in"><title>{`${d.date}: ${d.input} input`}</title></rect>
              <rect x={x} y={40 - hi - ho} width={bw} height={ho} className="ac-chart__out"><title>{`${d.date}: ${d.output} output`}</title></rect>
            </g>
          );
        })}
      </svg>
      <div className="ac-chart__axis"><span>{daily[0]?.date.slice(5)}</span><span>{daily[daily.length - 1]?.date.slice(5)}</span></div>
      {metric === 'tokens' && <div className="ac-legend"><span><i className="ac-chart__in" /> Input</span><span><i className="ac-chart__out" /> Output</span></div>}
    </div>
  );
}

function FeatureBars({ rows }: { rows: { feature: string; total: number; requests: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="ac-bars">
      {rows.map((r) => (
        <div className="ac-bars__row" key={r.feature}>
          <div className="ac-bars__label">{FEATURE_LABEL[r.feature] ?? label(r.feature)}</div>
          <div className="ac-bars__track"><div className="ac-bars__fill" style={{ width: `${(r.total / max) * 100}%` }} /></div>
          <div className="ac-bars__value">{compact(r.total)} <span className="ac__muted">· {r.requests} calls</span></div>
        </div>
      ))}
    </div>
  );
}

const TrackingNote = ({ since }: { since: string | null }) => (
  <p className="ac__muted ac-note">{since ? `Token tracking started ${when(since)}. Usage before that date was not recorded and is not included.` : 'No AI usage recorded yet. Tracking starts with the first AI call after this update; earlier usage was not recorded.'}</p>
);


// ── WhatsApp pairing: shows the QR the existing connection is waiting for. Polls an admin-only endpoint; no session data. ──
const PAIR_TEXT: Record<string, { title: string; text: string; tone: string }> = {
  connected: { title: 'Connected', text: 'WhatsApp is connected using the saved session.', tone: 'ok' },
  starting: { title: 'Connecting…', text: 'Starting the WhatsApp connection with the saved session.', tone: 'warn' },
  reconnecting: { title: 'Reconnecting', text: 'The connection dropped and is reconnecting automatically with the saved session.', tone: 'warn' },
  awaiting_qr: { title: 'Pairing required', text: 'WhatsApp is waiting to be linked. Scan the QR code from the company phone.', tone: 'bad' },
  logged_out: { title: 'Pairing stopped', text: 'The phone refused several pairing codes. Request a new code to try again.', tone: 'bad' },
  stopped: { title: 'Not running', text: 'The assistant is not running on this server yet. Open Configuration to finish the setup.', tone: 'muted' },
};
function WhatsAppPairing({ flash, onConnected, onSetup }: { flash: (m: string) => void; onConnected: () => void; onSetup?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const load = useCallback(() => assistantAdminApi.pairing().then((r) => { setData(r.data); setError(null); }).catch((e) => setError(errText(e))), []);
  useEffect(() => { load(); }, [load]);
  // Poll only while not connected, faster while a code is on screen
  const state = data?.state;
  useEffect(() => {
    if (!state || state === 'connected' || state === 'stopped') return;
    const t = setInterval(() => { load(); setTick(Date.now()); }, show ? 3000 : 10000);
    return () => clearInterval(t);
  }, [state, show, load]);
  const prev = useState<{ v: string | null }>({ v: null })[0];
  useEffect(() => {
    if (prev.v && prev.v !== 'connected' && state === 'connected') { setShow(false); flash('WhatsApp connected.'); onConnected(); }
    prev.v = state ?? null;
  }, [state, prev, flash, onConnected]);
  if (error) return <div className="ac__error" role="alert">{error}</div>;
  if (!data) return <div className="ac-panel"><div className="ac__muted">Loading WhatsApp status…</div></div>;
  const info = PAIR_TEXT[state] ?? { title: label(state), text: '', tone: 'muted' };
  const qr = data.qr;
  const expired = qr && Date.parse(qr.expires_at) < tick;
  const startNow = async () => {
    setBusy(true);
    try {
      const r = await assistantAdminApi.startWhatsApp();
      flash(r.data.ok ? 'WhatsApp is starting. Click Show QR code when it appears.' : `WhatsApp did not start: ${r.data.problems.join(' ')}`);
      setShow(true); load();
    } catch (e) { flash(errText(e)); } finally { setBusy(false); }
  };
  const requestNew = async () => {
    setBusy(true);
    try { await assistantAdminApi.requestNewPairing(); flash('A new pairing code was requested.'); setShow(true); load(); }
    catch (e) { flash(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="ac-panel ac-pair">
      <div className="ac-panel__head">
        <h2><Smartphone size={15} /> WhatsApp connection</h2>
        <Badge tone={info.tone}>{info.title}</Badge>
      </div>
      <p className="ac-pair__text">{info.text}{data.account ? ` Account ${data.account}.` : ''}</p>
      {state === 'stopped' && data.problems?.length > 0 && (
        <ul className="ac-setup__problems">{data.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>
      )}
      {state === 'stopped' && (
        <div className="ac-toolbar">
          {data.can_start && <button className="btn-primary ac-btn" disabled={busy} onClick={startNow}><RefreshCw size={14} /> {busy ? 'Starting…' : 'Start WhatsApp'}</button>}
          {onSetup && <button className="btn-secondary ac-btn" onClick={onSetup}>Open Configuration</button>}
        </div>
      )}
      {state === 'connected' && <GroupPicker current={data.group_jid} flash={flash} />}
      {state === 'awaiting_qr' && !show && <button className="btn-primary ac-btn" onClick={() => { setShow(true); load(); }}><QrCode size={14} /> Show QR code</button>}
      {state === 'logged_out' && <button className="btn-primary ac-btn" disabled={busy} onClick={requestNew}><RefreshCw size={14} /> Request a new QR code</button>}
      {show && state === 'awaiting_qr' && (
        <div className="ac-pair__body">
          <div className="ac-pair__qr">
            {!qr && <div className="ac__muted">Waiting for a code…</div>}
            {qr && qr.render === 'ok' && !expired && <img src={qr.image} alt="WhatsApp pairing QR code" width={232} height={232} />}
            {qr && qr.render !== 'ok' && <div className="ac__muted">The server cannot draw QR codes yet (the "qrcode" package is not installed).</div>}
            {qr && expired && <div className="ac__muted">This code expired. A new one appears automatically.</div>}
          </div>
          <ol className="ac-pair__steps">
            <li>Open WhatsApp on the company phone.</li>
            <li>Go to <strong>Settings → Linked Devices → Link a Device</strong>.</li>
            <li>Point the phone at this code. The page updates by itself once it connects.</li>
          </ol>
          <button className="btn-secondary ac-btn" onClick={() => setShow(false)}>Hide code</button>
        </div>
      )}
    </section>
  );
}

// The WhatsApp group the assistant works in: chosen from the groups the company WhatsApp is a member of
function GroupPicker({ current, flash }: { current: string | null; flash: (m: string) => void }) {
  const { data, error } = useLoader(() => assistantAdminApi.whatsappGroups().then((r) => r.data as { name: string; jid: string }[]));
  const [pick, setPick] = useState<string>(current ?? '');
  const [saved, setSaved] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPick(current ?? ''); setSaved(current); }, [current]);
  const save = async () => {
    setBusy(true);
    try { const r = await assistantAdminApi.chooseGroup(pick); setSaved(pick); flash(`Reminders, reports and answers now go to "${r.data.name}".`); }
    catch (e) { flash(errText(e)); } finally { setBusy(false); }
  };
  const groups = [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const currentName = groups.find((g) => g.jid === saved)?.name;
  return (
    <div className="ac-group">
      <label className="form-label" htmlFor="wa-group">Group the assistant works in</label>
      {error && <div className="ac__error">{error}</div>}
      <div className="ac-phone__row">
        <select id="wa-group" className="form-input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!data}>
          {!data && <option value="">Loading groups…</option>}
          {data && !groups.some((g) => g.jid === pick) && <option value="">Choose a group</option>}
          {groups.map((g) => <option key={g.jid} value={g.jid}>{g.name || 'Unnamed group'}</option>)}
        </select>
        <button className="btn-primary ac-btn" disabled={busy || !pick || pick === saved} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="ac__muted ac-note">{currentName ? `Now: ${currentName}. ` : saved ? 'Now: a group the company WhatsApp is no longer in. ' : 'No group chosen yet. '}Only groups the company WhatsApp has joined are listed.</p>
    </div>
  );
}

// What the bot did with each recent incoming message, so "why didn't it reply?" has an answer. No message text.
const OUTCOME: Record<string, { label: string; tone: string; why: string }> = {
  replied: { label: 'Replied', tone: 'ok', why: '' },
  not_mentioned: { label: 'Not mentioned', tone: 'muted', why: 'The bot was not mentioned. Pick it from the @ list; typing its name is not a mention.' },
  not_recognised: { label: 'Sender not linked', tone: 'warn', why: 'This sender is not linked to a Loop employee, so the bot stays silent. Link their number in Employee linking.' },
  could_not_decrypt: { label: 'Could not read', tone: 'warn', why: 'WhatsApp had not shared the encryption keys yet (common right after pairing). It fixes itself; ask again in a minute.' },
  not_text: { label: 'Not text', tone: 'muted', why: 'Photos, stickers and voice notes are ignored.' },
  send_failed: { label: 'Reply failed', tone: 'bad', why: 'The reply could not be sent. Check the WhatsApp connection above.' },
};
function WhatsAppActivity() {
  const { data, error, reload } = useLoader(() => assistantAdminApi.whatsappActivity().then((r) => r.data as any[]));
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  return (
    <Panel wide title="Recent WhatsApp messages" action={<button className="btn-secondary ac-btn" onClick={reload}><RefreshCw size={14} /> Refresh</button>}>
      {error && <div className="ac__error">{error}</div>}
      {data && data.length === 0 && <p className="ac__muted">No messages received yet since this list was added. Mention the bot in the group to test it.</p>}
      {data && data.length > 0 && (
        <div className="ac__table-wrap"><table className="ac__table ac-table">
          <thead><tr><th>Time</th><th>Where</th><th>From</th><th>What the bot did</th></tr></thead>
          <tbody>{data.map((e) => {
            const o = OUTCOME[e.outcome] ?? { label: label(e.outcome), tone: 'muted', why: '' };
            const hidden = e.outcome === 'not_recognised' && e.phone_hidden ? ' Their phone number is hidden from the group, so the bot cannot match them by number.' : '';
            return (
              <tr key={e.id}>
                <td>{when(e.created_at)}</td>
                <td>{e.place}</td>
                <td>{e.linked ? <strong>{e.sender}</strong> : <span className="ac__mono">{e.sender}</span>}</td>
                <td><Badge tone={o.tone}>{o.label}</Badge>{(o.why || hidden) && <div className="ac__muted">{o.why}{hidden}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </Panel>
  );
}

// ── Overview ──
function Overview({ go, flash }: { go: (t: Tab) => void; flash: (m: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';   // admins and managers manage WhatsApp
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.overview().then((r) => r.data));
  const wa = data?.whatsapp; const u = data?.usage;
  const waTone = wa?.state === 'connected' ? 'ok' : wa?.state === 'connecting' ? 'warn' : 'bad';
  return (
    <section>
      <div className="ac__filters"><button className="btn-secondary ac-btn" onClick={reload}><RefreshCw size={14} /> Refresh</button></div>
      {/* Admins and managers can view the WhatsApp connection and pair it */}
      {isAdmin && <WhatsAppPairing flash={flash} onConnected={reload} onSetup={() => go('config')} />}
      {isAdmin && <WhatsAppActivity />}
      <Status state={data} loading={loading} error={error} />
      {data && (
        <>
          <div className="ac-stats">
            <Stat icon={MessageCircle} label="WhatsApp" value={WA_LABEL[wa.state] ?? label(wa.state)} tone={waTone} hint={wa.account ?? undefined} />
            <Stat icon={Users} label="Linked employees" value={num(data.linking.linked)} hint={`of ${data.linking.total} staff`} />
            <Stat icon={UserX} label="Not linked" value={num(data.linking.unlinked)} tone={data.linking.unlinked ? 'warn' : 'ok'} />
            <Stat icon={Clock} label="Pending linking" value={num(data.linking.pending)} hint="Verifications in progress and unknown senders awaiting review" />
            <Stat icon={Activity} label="AI requests" value={num(u.totals.requests)} hint={`${num(data.requests.total)} assistant requests`} />
            <Stat icon={Cpu} label="Total tokens" value={compact(u.totals.total)} />
            <Stat icon={CalendarDays} label="Tokens today" value={compact(u.periods.today.total)} />
            <Stat icon={CalendarRange} label="Tokens this month" value={compact(u.periods.this_month.total)} />
          </div>
          <div className="ac-grid">
            <Panel title="WhatsApp overview" action={<button className="btn-secondary ac-btn" onClick={() => go('linking')}>Manage linking</button>}>
              <KV k="Bot connection" v={<Badge tone={waTone}>{WA_LABEL[wa.state] ?? label(wa.state)}</Badge>} />
              <KV k="Connected account" v={wa.account ?? '—'} />
              <KV k="Notification group" v={wa.group_configured ? (wa.group_name ?? 'Configured') : 'Not configured'} />
              <KV k="Linked employees" v={num(data.linking.linked)} />
              <KV k="Unlinked employees" v={num(data.linking.unlinked)} />
              <KV k="Last connected" v={when(wa.last_connected_at)} />
            </Panel>
            <Panel title="AI usage overview" action={<button className="btn-secondary ac-btn" onClick={() => go('usage')}>Details</button>}>
              <KV k="Model" v={data.model ?? '—'} />
              <KV k="Input tokens" v={num(u.totals.input)} />
              <KV k="Output tokens" v={num(u.totals.output)} />
              <KV k="Total tokens" v={num(u.totals.total)} />
              <KV k="Today · last 7 days · this month" v={`${compact(u.periods.today.total)} · ${compact(u.periods.last_7_days.total)} · ${compact(u.periods.this_month.total)}`} />
              <UsageChart daily={u.daily} />
              <TrackingNote since={u.tracking_since} />
            </Panel>
          </div>
          <h2 className="ac-section-title">Recent activity</h2>
          <div className="ac-grid ac-grid--4">
            <Panel title="AI requests">{data.recent.requests.length ? <ul className="ac-feed">{data.recent.requests.map((r: any) => <li key={r.id}><Activity size={14} /><div><strong>{label(r.intent)}</strong> · {label(r.status)}<div className="ac__muted">{r.employee ?? '—'} · {when(r.created_at)}</div></div></li>)}</ul> : <p className="ac__muted">No requests yet.</p>}</Panel>
            <Panel title="Linking">{data.recent.linking.length ? <ul className="ac-feed">{data.recent.linking.map((r: any) => <li key={r.id}><Link2 size={14} /><div><strong>{label(r.action)}</strong> · {r.detail}<div className="ac__muted">{r.actor ?? '—'} · {when(r.created_at)}</div></div></li>)}</ul> : <p className="ac__muted">No linking activity yet.</p>}</Panel>
            <Panel title="WhatsApp notifications">{data.recent.notifications.length ? <ul className="ac-feed">{data.recent.notifications.map((r: any) => <li key={r.id}><Bell size={14} /><div><strong>{label(r.kind)}</strong> <Badge tone={r.status === 'sent' ? 'ok' : r.status === 'pending' ? 'warn' : r.status === 'failed' ? 'bad' : 'muted'}>{label(r.status)}</Badge><div className="ac__muted">{when(r.sent_at ?? r.created_at)}</div></div></li>)}</ul> : <p className="ac__muted">No notifications yet.</p>}</Panel>
            <Panel title="Failures">{data.recent.failures.length ? <ul className="ac-feed">{data.recent.failures.map((r: any) => <li key={r.id}><AlertTriangle size={14} /><div><strong>{label(r.intent)}</strong> · {r.failure_kind ?? 'failed'}<div className="ac__muted">{r.employee ?? '—'} · {when(r.updated_at)}</div></div></li>)}</ul> : <p className="ac__muted"><CheckCircle2 size={14} /> No failures.</p>}</Panel>
          </div>
        </>
      )}
    </section>
  );
}

// ── Employee linking ──
// One row per employee: their WhatsApp number, whether it is linked, and one action. Admins enter a number and click Link;
// it is active straight away. The row updates at once, without a page refresh.
function LinkingTab({ flash }: { flash: (m: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';   // admins and managers link numbers
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.linking().then((r) => r.data));
  const [q, setQ] = useState('');
  // Rows changed in this session, shown immediately while the list reloads from the server
  const [done, setDone] = useState<Record<number, { number: string; at: string }>>({});
  useEffect(() => { setDone({}); }, [data]);
  const all: any[] = (data ?? []).map((r: any) => (done[r.user_id] ? { ...r, status: 'linked', number: done[r.user_id].number, updated_at: done[r.user_id].at } : r));
  const rows = all.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const linked = all.filter((r) => r.status === 'linked').length;
  const onLinked = (userId: number, masked: string) => { setDone((d) => ({ ...d, [userId]: { number: masked, at: new Date().toISOString() } })); reload(); };
  return (
    <section>
      <div className="ac-stats ac-stats--3">
        <Stat icon={Users} label="Linked" value={linked} tone="ok" />
        <Stat icon={UserX} label="Not linked" value={all.length - linked} tone={all.length - linked ? 'warn' : undefined} />
        <Stat icon={Users} label="Staff" value={all.length} />
      </div>
      <Panel wide title="WhatsApp employee linking" action={
        <label className="ac-search"><Search size={14} /><input className="form-input" placeholder="Search employees" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" /></label>}>
        <p className="ac__muted ac-note">{isAdmin
          ? "Enter the employee's WhatsApp number with its country code and click Link. It is active straight away and recorded in the audit history."
          : 'You can view numbers here.'}</p>
        <Status state={data} loading={loading} error={error} />
        {data && (
          <div className="ac__table-wrap"><table className="ac__table ac-table">
            <thead><tr><th>Employee</th><th>WhatsApp number</th><th>Status</th><th>Last update</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.user_id}>
                <td><strong>{r.name}</strong><div className="ac__muted">{label(r.role)}</div></td>
                <td><NumberCell userId={r.user_id} number={r.number ?? r.declared_number} linked={r.status === 'linked'} canEdit={isAdmin} onLinked={onLinked} flash={flash} /></td>
                <td><Badge tone={r.status === 'linked' ? 'ok' : 'muted'}>{r.status === 'linked' ? 'Linked' : 'Not linked'}</Badge></td>
                <td>{when(r.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && rows.length === 0 && <p className="ac__muted">No employees match.</p>}
      </Panel>
    </section>
  );
}

// Shows the number; for admins, an input to link one (or a Change button once linked)
function NumberCell({ userId, number, linked, canEdit, onLinked, flash }: { userId: number; number: string | null; linked: boolean; canEdit: boolean; onLinked: (userId: number, masked: string) => void; flash: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = await assistantAdminApi.saveEmployeePhone(userId, value.trim());
      setValue(''); setEditing(false);
      onLinked(userId, res.data.masked);
      flash('Linked. The employee can use the assistant from this number.');
    } catch (e) { flash(errText(e)); } finally { setBusy(false); }
  };
  const showInput = canEdit && (!linked || editing);
  return (
    <div className="ac-phone">
      {number && <span className="ac__mono">{number}</span>}
      {!number && !showInput && <span className="ac__muted">—</span>}
      {canEdit && linked && !editing && <button className="ac-linkbtn" onClick={() => setEditing(true)}>Change</button>}
      {showInput && (
        <div className="ac-phone__row">
          <input className="form-input" placeholder="+91 98765 43210" value={value} autoFocus={editing}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !busy) save(); }} aria-label="WhatsApp number with country code" />
          <button className="btn-primary ac-btn" disabled={busy || !value.trim()} onClick={save}><Link2 size={14} /> {busy ? 'Linking…' : 'Link'}</button>
          {editing && <button className="btn-secondary ac-btn" disabled={busy} onClick={() => { setEditing(false); setValue(''); }}>Cancel</button>}
        </div>
      )}
    </div>
  );
}

// ── AI usage ──
function UsageTab() {
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.usage(30).then((r) => r.data));
  const p = data?.periods;
  return (
    <section>
      <div className="ac__filters"><button className="btn-secondary ac-btn" onClick={reload}><RefreshCw size={14} /> Refresh</button></div>
      <Status state={data} loading={loading} error={error} />
      {data && (
        <>
          <div className="ac-stats ac-stats--5">
            <Stat icon={Cpu} label="Total tokens" value={num(data.totals.total)} />
            <Stat icon={Activity} label="Input tokens" value={num(data.totals.input)} />
            <Stat icon={Activity} label="Output tokens" value={num(data.totals.output)} />
            <Stat icon={MessageCircle} label="AI requests" value={num(data.totals.requests)} hint={data.totals.failed ? `${data.totals.failed} failed` : undefined} />
            <Stat icon={CalendarDays} label="Avg tokens / request" value={num(data.totals.average_per_request)} />
          </div>
          <div className="ac-grid">
            <Panel title="Usage periods">
              <div className="ac__table-wrap"><table className="ac__table ac-table">
                <thead><tr><th>Period</th><th>Requests</th><th>Input</th><th>Output</th><th>Total</th></tr></thead>
                <tbody>{([['Today', p.today], ['Last 7 days', p.last_7_days], ['This month', p.this_month], ['All recorded', p.all_time]] as [string, any][]).map(([n, v]) => (
                  <tr key={n}><td>{n}</td><td>{num(v.requests)}</td><td>{num(v.input)}</td><td>{num(v.output)}</td><td><strong>{num(v.total)}</strong></td></tr>
                ))}</tbody>
              </table></div>
              <KV k="Model" v={(data.models.length ? data.models : [data.model]).filter(Boolean).join(', ') || '—'} />
              <TrackingNote since={data.tracking_since} />
            </Panel>
            <Panel title="Usage by feature"><FeatureBars rows={data.by_feature} /></Panel>
            <Panel title="Daily tokens (input vs output), last 30 days"><UsageChart daily={data.daily} /></Panel>
            <Panel title="AI requests per day, last 30 days"><UsageChart daily={data.daily} metric="requests" /></Panel>
          </div>
          <p className="ac__muted ac-note">Figures are the token counts OpenAI returned with each response. Nothing is estimated, and this page makes no AI calls.</p>
        </>
      )}
    </section>
  );
}

function QueueTab() {
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.queue().then((r) => r.data));
  return (
    <section>
      <div className="ac__filters"><button className="ac__btn" onClick={reload}>Refresh</button></div>
      <Status state={data} loading={loading} error={error} />
      {data && data.length === 0 && <div className="ac__muted">Nothing is waiting or running.</div>}
      {data && data.length > 0 && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead><tr><th>Request</th><th>Employee</th><th>Intent</th><th>Status</th><th>Confirmation</th><th>Queue priority</th><th>Attempts</th><th>Created</th></tr></thead>
          <tbody>{data.map((r: any) => (
            <tr key={r.id}><td className="ac__mono">{r.id.slice(0, 8)}</td><td>{r.employee}</td><td>{label(r.intent)}</td><td>{label(r.status)}</td>
              <td>{r.confirmation ?? '—'}</td><td>{r.priority}</td><td>{r.execution_attempts}</td><td>{when(r.created_at)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function RequestsTab() {
  const [status, setStatus] = useState(''); const [intent, setIntent] = useState(''); const [q, setQ] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useLoader(() => assistantAdminApi.requests({ status: status || undefined, intent: intent || undefined, q: q || undefined, from: from || undefined, to: to || undefined, page, limit: 25 }).then((r) => r.data), [status, intent, q, from, to, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <section>
      <div className="ac__filters">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <input placeholder="Intent, e.g. CREATE_TASK" value={intent} onChange={(e) => { setIntent(e.target.value.toUpperCase()); setPage(1); }} aria-label="Intent" />
        <input placeholder="Search employee or ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" />
        <label>From <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label>To <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      </div>
      <Status state={data} loading={loading} error={error} />
      {data && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead><tr><th>Request</th><th>Employee</th><th>Intent</th><th>Status</th><th>Channel</th><th>Created</th></tr></thead>
          <tbody>{data.items.map((r: any) => (
            <tr key={r.id} className="ac__row" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.id); }}>
              <td className="ac__mono">{r.id.slice(0, 8)}</td><td>{r.employee}</td><td>{label(r.intent)}</td><td>{label(r.status)}</td><td>{r.channel}</td><td>{when(r.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && <div className="ac__pager"><button className="ac__btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages} · {data.total} requests</span><button className="ac__btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
      {open && <RequestDetail id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useLoader(() => assistantAdminApi.request(id).then((r) => r.data), [id]);
  return (
    <div className="ac__detail" role="region" aria-label="Request details">
      <div className="ac__detail-head"><h2>Request {id.slice(0, 8)}</h2><button className="ac__btn" onClick={onClose}>Close</button></div>
      <Status state={data} loading={loading} error={error} />
      {data && (
        <div className="ac__detail-grid">
          <div><h3>Summary</h3><p>Status: {label(data.status)}</p><p>Intent: {label(data.intent)}</p><p>Employee: {data.employee}</p><p>Channel: {data.channel}</p><p>Confidence: {data.confidence ?? '—'}</p></div>
          <div><h3>Extracted details</h3>{Object.keys(data.extracted).length ? <ul>{Object.entries(data.extracted).map(([k, v]) => <li key={k}>{label(k)}: {String(v)}</li>)}</ul> : <p className="ac__muted">None yet.</p>}
            {data.ambiguous?.length > 0 && <p>Unclear: {data.ambiguous.join(', ')}</p>}</div>
          <div><h3>Confirmation</h3><p>{data.confirmation.status ? label(data.confirmation.status) : 'Not requested'}</p><p>Expires: {when(data.confirmation.expires_at)}</p></div>
          <div><h3>Failure</h3>{data.failure ? <><p>Category: {data.failure.kind ?? '—'}</p><p className="ac__mono">{data.failure.last_error ?? ''}</p></> : <p className="ac__muted">No failure.</p>}
            <p>Retry: {data.retry.eligible ? 'allowed' : 'not allowed'} ({data.retry.reason})</p></div>
          <div className="ac__wide"><h3>Conversation</h3>{data.conversation.length === 0 ? <p className="ac__muted">No messages recorded around this request.</p> : <ol className="ac__messages">{data.conversation.map((m: any, i: number) => <li key={i} className={`ac__msg ac__msg--${m.role}`}><span className="ac__msg-role">{m.role === 'employee' ? 'Employee' : 'Assistant'}</span> {m.text} <span className="ac__muted">{when(m.at)}</span></li>)}</ol>}</div>
          <div className="ac__wide"><h3>Timeline</h3><ol className="ac__timeline">{data.timeline.map((t: any, i: number) => <li key={i}><strong>{label(t.event)}</strong>{t.from_state ? ` · ${label(t.from_state)} → ${label(t.to_state ?? '')}` : ''} <span className="ac__muted">{when(t.created_at)}</span>{t.detail ? <div className="ac__muted">{t.detail}</div> : null}</li>)}</ol></div>
          <div className="ac__wide"><h3>Execution attempts</h3>{data.attempts.length === 0 ? <p className="ac__muted">No attempts.</p> : <table className="ac__table"><thead><tr><th>Attempt</th><th>Result</th><th>Error</th><th>Finished</th></tr></thead><tbody>{data.attempts.map((a: any) => <tr key={a.attempt}><td>{a.attempt}</td><td>{label(a.status)}</td><td>{a.error ?? '—'}</td><td>{when(a.finished_at)}</td></tr>)}</tbody></table>}</div>
        </div>
      )}
    </div>
  );
}

// Unknown WhatsApp internal ids (@lid). Linking one is manual: an admin confirms in person and writes a note.
// Only the last four characters are shown; the full id is never sent to this screen.
function PendingSenders({ flash, onChange }: { flash: (m: string) => void; onChange: () => void }) {
  const pending = useLoader(() => assistantAdminApi.pendingSenders().then((r) => r.data));
  const staff = useLoader(() => assistantAdminApi.staffUsers().then((r) => r.data));
  const [form, setForm] = useState<Record<number, { user: string; verified: boolean; note: string }>>({});
  const edit = (id: number, patch: Partial<{ user: string; verified: boolean; note: string }>) =>
    setForm((f) => ({ ...f, [id]: { ...(f[id] ?? { user: '', verified: false, note: '' }), ...patch } }));
  const approve = async (id: number) => {
    const f = form[id];
    try {
      await assistantAdminApi.approvePending(id, { user_id: Number(f.user), in_person_verified: f.verified, note: f.note });
      flash('Linked. The approval is recorded in the audit history.');
      pending.reload(); onChange();
    } catch (e) { flash(errText(e)); }
  };
  const dismiss = async (id: number) => {
    if (!window.confirm('Dismiss this unknown sender? It will stay blocked.')) return;
    try { await assistantAdminApi.dismissPending(id, ''); flash('Dismissed. It stays blocked.'); pending.reload(); }
    catch (e) { flash(errText(e)); }
  };
  return (
    <div style={{ marginBottom: 24 }}>
      <h3>Pending WhatsApp senders</h3>
      <p>Unknown senders that messaged the company account. Link one only after you have verified in person that it is this employee's WhatsApp.</p>
      <Status state={pending.data} loading={pending.loading} error={pending.error} />
      {pending.data && pending.data.length === 0 && <p>No pending senders.</p>}
      {pending.data && pending.data.length > 0 && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead><tr><th>Ends in</th><th>First seen</th><th>Messages</th><th>Expires in</th><th>Employee</th><th>In-person check</th><th>Audit note</th><th /></tr></thead>
          <tbody>{pending.data.map((p: any) => {
            const f = form[p.id] ?? { user: '', verified: false, note: '' };
            const ready = !!f.user && f.verified && f.note.trim().length >= 10;
            return (
              <tr key={p.id}>
                <td className="ac__mono">…{p.last4}</td><td>{when(p.first_seen)}</td><td>{p.message_count}</td><td>{p.days_left} days</td>
                <td><select value={f.user} onChange={(e) => edit(p.id, { user: e.target.value })} aria-label={`Employee for sender ending ${p.last4}`}>
                  <option value="">Choose…</option>
                  {(staff.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({label(u.role)})</option>)}
                </select></td>
                <td><label><input type="checkbox" checked={f.verified} onChange={(e) => edit(p.id, { verified: e.target.checked })} /> I verified this person in person</label></td>
                <td><input value={f.note} onChange={(e) => edit(p.id, { note: e.target.value })} placeholder="At least 10 characters" aria-label={`Audit note for sender ending ${p.last4}`} /></td>
                <td>
                  <button className="ac__btn" disabled={!ready} onClick={() => approve(p.id)}>Link</button>{' '}
                  <button className="ac__btn ac__btn--danger" onClick={() => dismiss(p.id)}>Dismiss</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

function IdentitiesTab({ flash }: { flash: (m: string) => void }) {
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.identities().then((r) => r.data));
  const revoke = async (id: number, who: string) => {
    if (!window.confirm(`Revoke the messaging connection for ${who}? They will need to link again to use the assistant.`)) return;
    try { await assistantAdminApi.revokeIdentity(id); flash('Connection revoked and recorded in the audit history.'); reload(); }
    catch (e) { flash(errText(e)); }
  };
  return (
    <section>
      <PendingSenders flash={flash} onChange={reload} />
      <Status state={data} loading={loading} error={error} />
      {data && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead><tr><th>Employee</th><th>Channel</th><th>Number</th><th>Status</th><th>Linked</th><th>Last activity</th><th /></tr></thead>
          <tbody>{data.map((i: any) => (
            <tr key={i.id}><td>{i.employee}</td><td>{i.channel}</td><td className="ac__mono">{i.number}</td><td>{label(i.status)}</td><td>{when(i.linked_at)}</td><td>{when(i.last_activity)}</td>
              <td>{i.status === 'active' && <button className="ac__btn ac__btn--danger" onClick={() => revoke(i.id, i.employee)}>Revoke</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function ConversationsTab() {
  const [key, setKey] = useState<string | null>(null);
  const { data, error, loading } = useLoader(() => assistantAdminApi.conversations().then((r) => r.data));
  const msgs = useLoader(() => (key ? assistantAdminApi.conversationMessages(key).then((r) => r.data) : Promise.resolve(null)), [key]);
  return (
    <section className="ac__split">
      <div>
        <Status state={data} loading={loading} error={error} />
        {data && <ul className="ac__list">{data.map((c: any) => (
          <li key={c.conversation_key}><button className={`ac__list-item${key === c.conversation_key ? ' is-active' : ''}`} onClick={() => setKey(c.conversation_key)}>
            <strong>{c.employee ?? 'Unknown employee'}</strong><span className="ac__muted"> · {c.channel} · {c.conversation_id}</span><div className="ac__muted">{c.requests} requests · last {when(c.last_activity)}</div>
          </button></li>))}</ul>}
      </div>
      <div>
        {!key && <div className="ac__muted">Select a conversation to view its messages.</div>}
        <Status state={msgs.data} loading={msgs.loading} error={msgs.error} />
        {msgs.data && <ol className="ac__messages">{msgs.data.items.map((m: any, i: number) => <li key={i} className={`ac__msg ac__msg--${m.role}`}><span className="ac__msg-role">{m.role === 'employee' ? 'Employee' : 'Assistant'}</span> {m.text} <span className="ac__muted">{when(m.created_at)}</span></li>)}</ol>}
      </div>
    </section>
  );
}

function FailuresTab({ flash }: { flash: (m: string) => void }) {
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.failures().then((r) => r.data));
  const retry = async (id: string) => {
    if (!window.confirm('Retry this request? The same action will run once more, using its existing idempotency key.')) return;
    try { await assistantAdminApi.retry(id); flash('Retry queued and recorded in the audit history.'); reload(); }
    catch (e) { flash(errText(e)); }
  };
  return (
    <section>
      <Status state={data} loading={loading} error={error} />
      {data && data.length === 0 && <div className="ac__muted">No failed requests.</div>}
      {data && data.length > 0 && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead><tr><th>Request</th><th>Employee</th><th>Intent</th><th>Category</th><th>Reason</th><th>Attempts</th><th>Last attempt</th><th>Retry</th></tr></thead>
          <tbody>{data.map((f: any) => (
            <tr key={f.id}><td className="ac__mono">{f.id.slice(0, 8)}</td><td>{f.employee}</td><td>{label(f.intent)}</td><td>{f.failure_kind ?? '—'}</td><td className="ac__reason">{f.reason}</td><td>{f.attempts}</td>
              <td>{f.last_attempt ? `${f.last_attempt.attempt} · ${when(f.last_attempt.at)}` : '—'}</td>
              <td>{f.retry_eligible ? <button className="ac__btn" onClick={() => retry(f.id)}>Retry</button> : <span className="ac__muted" title={f.retry_reason}>Not allowed</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function AuditTab() {
  const [source, setSource] = useState<'request' | 'admin'>('request');
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoader(() => assistantAdminApi.audit({ source, q: q || undefined }).then((r) => r.data), [source, q]);
  return (
    <section>
      <div className="ac__filters">
        <select value={source} onChange={(e) => setSource(e.target.value as any)} aria-label="Audit source">
          <option value="request">Request events</option><option value="admin">Administrative actions</option>
        </select>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit" />
      </div>
      <Status state={data} loading={loading} error={error} />
      {data && (
        <div className="ac__table-wrap"><table className="ac__table">
          <thead>{data.source === 'request'
            ? <tr><th>When</th><th>Request</th><th>Employee</th><th>Event</th><th>From → to</th><th>Detail</th></tr>
            : <tr><th>When</th><th>Administrator</th><th>Action</th><th>Target</th><th>Detail</th></tr>}</thead>
          <tbody>{data.items.map((e: any) => data.source === 'request' ? (
            <tr key={e.id}><td>{when(e.created_at)}</td><td className="ac__mono">{e.request_id?.slice(0, 8)}</td><td>{e.employee ?? '—'}</td><td>{label(e.event)}</td><td>{e.from_state ? `${label(e.from_state)} → ${label(e.to_state ?? '')}` : '—'}</td><td>{e.detail ?? ''}</td></tr>
          ) : (
            <tr key={e.id}><td>{when(e.created_at)}</td><td>{e.actor}</td><td>{label(e.action)}</td><td className="ac__mono">{e.target}</td><td>{e.detail}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

// Setup: what the server still needs, in plain words, and the AI key field. The key is stored encrypted and never shown.
function SetupPanel({ data, onSaved, flash }: { data: any; onSaved: () => void; flash: (m: string) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const running = data.assistant_enabled && data.api_key_configured;
  const save = async () => {
    setBusy(true);
    try {
      const r = await assistantAdminApi.saveAiKey(key.trim());
      setKey('');
      flash(r.data.running ? 'Saved. The assistant and WhatsApp are starting: open Overview to scan the QR code.' : 'Key saved, but the assistant is still off. See the list below.');
      onSaved();
    } catch (e) { flash(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="ac-panel ac-setup">
      <div className="ac-panel__head"><h2>Setup</h2><Badge tone={running ? 'ok' : 'bad'}>{running ? 'Assistant running' : 'Assistant off'}</Badge></div>
      {!running && data.problems?.length > 0 && (
        <ul className="ac-setup__problems">{data.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>
      )}
      {data.settings_file_loaded === false && (
        <p className="ac__muted">The server is not running in production mode (NODE_ENV is "{data.node_env}"), so the WhatsApp settings that ship with the code are not loaded.</p>
      )}
      <label className="form-label" htmlFor="ai-key">OpenAI API key {data.api_key_configured ? '(saved — paste a new one to replace it)' : ''}</label>
      <div className="ac-phone__row">
        <input id="ai-key" className="form-input" type="password" autoComplete="off" placeholder="sk-..." value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn-primary ac-btn" disabled={busy || key.trim().length < 20} onClick={save}>{busy ? 'Saving…' : 'Save key'}</button>
      </div>
      <p className="ac__muted ac-note">Stored encrypted on the server and never shown again. Saving starts the assistant and WhatsApp straight away; then scan the QR code on Overview.</p>
    </section>
  );
}

function ConfigTab({ flash }: { flash: (m: string) => void }) {
  const { data, error, loading, reload } = useLoader(() => assistantAdminApi.config().then((r) => r.data));
  const row = (k: string, v: any) => <div className="ac__config-row" key={k}><span>{k}</span><strong>{typeof v === 'boolean' ? (v ? 'Enabled' : 'Disabled') : String(v ?? '—')}</strong></div>;
  return (
    <section>
      <Status state={data} loading={loading} error={error} />
      {data && <SetupPanel data={data} onSaved={reload} flash={flash} />}
      {data && (
        <div className="ac__config">
          {row('Provider', data.provider)}
          {row('Model', data.model)}
          {row('Timezone', data.timezone)}
          {row('Assistant', data.assistant_enabled)}
          {row('Simulator', data.simulator_enabled)}
          {row('Execution of Loop actions', data.execution_enabled)}
          {row('Worker running', data.worker_running)}
          {row('Registered actions', data.registered_actions)}
          {row('Queue max attempts', data.queue.max_attempts)}
          {row('Queue lease (seconds)', data.queue.lease_seconds)}
          {row('Confirmation/queue expiry (seconds)', data.queue.expiry_seconds)}
          {row('API key configured', data.api_key_configured ? 'Yes' : 'No')}
          {row('Provider connectivity', data.provider_connectivity)}
        </div>
      )}
    </section>
  );
}
