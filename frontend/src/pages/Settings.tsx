import { useEffect, useState } from 'react';
import { RiUserLine, RiNotification3Line, RiTeamLine, RiShieldLine, RiEyeLine, RiEyeOffLine, RiCheckLine } from 'react-icons/ri';
import Layout from '../components/Layout/Layout';
import Avatar from '../components/UI/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, capacityApi } from '../services/api';
import '../css/pages/Settings.css';

type Section = 'profile' | 'notifications' | 'team' | 'security';

const POD_LABEL: Record<string, string> = { pod1: 'Pod 1', pod2: 'Pod 2' };
const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator', manager: 'Manager', employee: 'Employee', client: 'Client',
};

// ─── Notification prefs helpers ───────────────────────────────

const GLOBAL_DEFAULTS = { capacity_warnings: true, weekly_digest: false };

function loadGlobalPrefs() {
  try {
    const s = localStorage.getItem('notif_global');
    return s ? { ...GLOBAL_DEFAULTS, ...JSON.parse(s) } : { ...GLOBAL_DEFAULTS };
  } catch { return { ...GLOBAL_DEFAULTS }; }
}

const CLIENT_PREF_DEFAULTS = { approvals: true, responses: true, comments: true };

// ─── Component ────────────────────────────────────────────────

interface ClientRow { id: number; name: string; email: string; avatar_color: string; company_name: string | null; }

export default function Settings() {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>('profile');

  // ── Global notification prefs
  const [globalPrefs, setGlobalPrefs] = useState(loadGlobalPrefs);
  const toggleGlobal = (key: keyof typeof GLOBAL_DEFAULTS) => {
    const next = { ...globalPrefs, [key]: !globalPrefs[key] };
    setGlobalPrefs(next);
    localStorage.setItem('notif_global', JSON.stringify(next));
  };

  // ── Notification client data
  const [notifPodTab, setNotifPodTab] = useState<'pod1' | 'pod2'>('pod1');
  const [clientsByPod, setClientsByPod] = useState<{ pod1: ClientRow[]; pod2: ClientRow[]; unassigned: ClientRow[] }>({ pod1: [], pod2: [], unassigned: [] });
  const [myClients, setMyClients] = useState<ClientRow[]>([]);
  const [notifClientId, setNotifClientId] = useState<number | null>(null);
  const [clientPrefs, setClientPrefs] = useState<typeof CLIENT_PREF_DEFAULTS>(CLIENT_PREF_DEFAULTS);
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    if (section !== 'notifications' || user?.role === 'client') return;
    setNotifLoading(true);
    if (user?.role === 'admin') {
      usersApi.clientsByPod()
        .then((r) => { setClientsByPod(r.data); })
        .catch(() => {})
        .finally(() => setNotifLoading(false));
    } else {
      usersApi.myClients()
        .then((r) => {
          setMyClients(Array.isArray(r.data) ? r.data : []);
        })
        .catch(() => {})
        .finally(() => setNotifLoading(false));
    }
  }, [section]);

  // Active client list based on role/pod tab
  const activeClients: ClientRow[] = user?.role === 'admin'
    ? clientsByPod[notifPodTab] ?? []
    : myClients;

  const loadAndSetClientPrefs = (clientId: number) => {
    usersApi.getNotifPrefs(clientId)
      .then((r) => setClientPrefs({ ...CLIENT_PREF_DEFAULTS, ...r.data }))
      .catch(() => setClientPrefs({ ...CLIENT_PREF_DEFAULTS }));
  };

  // When active client list changes, auto-select the first client
  useEffect(() => {
    if (activeClients.length > 0) {
      const first = activeClients[0];
      setNotifClientId(first.id);
      loadAndSetClientPrefs(first.id);
    } else {
      setNotifClientId(null);
    }
  }, [notifPodTab, myClients.length, clientsByPod.pod1.length, clientsByPod.pod2.length]);

  const selectClient = (id: number) => {
    setNotifClientId(id);
    loadAndSetClientPrefs(id);
  };

  const toggleClientPref = (key: keyof typeof CLIENT_PREF_DEFAULTS) => {
    if (!notifClientId) return;
    const next = { ...clientPrefs, [key]: !clientPrefs[key] };
    setClientPrefs(next);
    usersApi.saveNotifPrefs(notifClientId, next).catch(() => {});
  };

  // ── Team & pods
  const [podTab, setPodTab] = useState<'pod1' | 'pod2'>('pod1');
  const [podMembers, setPodMembers] = useState<any[]>([]);
  const [podLoading, setPodLoading] = useState(false);

  useEffect(() => {
    if (section !== 'team') return;
    setPodLoading(true);
    capacityApi.team(user?.role === 'admin' ? podTab : undefined)
      .then((r) => setPodMembers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setPodMembers([]))
      .finally(() => setPodLoading(false));
  }, [section, podTab]);

  // ── Security
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submitPassword = async () => {
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      setPwMsg({ ok: false, text: 'All fields are required' }); return;
    }
    if (pwForm.next.length < 6) {
      setPwMsg({ ok: false, text: 'New password must be at least 6 characters' }); return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg({ ok: false, text: 'New passwords do not match' }); return;
    }
    setPwSaving(true); setPwMsg(null);
    try {
      await usersApi.changePassword(pwForm.current, pwForm.next);
      setPwMsg({ ok: true, text: 'Password updated successfully' });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.response?.data?.error || 'Error updating password' });
    } finally { setPwSaving(false); }
  };

  const navItems: { key: Section; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: 'profile',       label: 'Profile',       icon: <RiUserLine size={15} /> },
    { key: 'notifications', label: 'Notifications', icon: <RiNotification3Line size={15} /> },
    { key: 'team',          label: 'Team & pods',   icon: <RiTeamLine size={15} /> },
    { key: 'security',      label: 'Security',      icon: <RiShieldLine size={15} /> },
  ];

  const activeClientRow = activeClients.find((c) => c.id === notifClientId) ?? null;

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ marginBottom: 24 }}>
          <h2 className="page-title">Settings</h2>
          <p className="page-subtitle">Manage your account preferences</p>
        </div>

        <div className="stg-layout">
          {/* Sidebar */}
          <nav className="stg-nav card">
            {navItems.filter((item) => !item.adminOnly || user?.role === 'admin').map((item) => (
              <button
                key={item.key}
                className={`stg-nav__item${section === item.key ? ' stg-nav__item--active' : ''}`}
                onClick={() => setSection(item.key)}
              >
                <span className="stg-nav__icon">{item.icon}</span>
                {item.label}
                <span className="stg-nav__arrow">›</span>
              </button>
            ))}
          </nav>

          <div className="stg-content">

            {/* ── Profile ── */}
            {section === 'profile' && (
              <div className="stg-panel card">
                <h3 className="stg-panel__title">Profile</h3>
                <div className="stg-profile-hero">
                  <div className="stg-profile-avatar">
                    {user && <Avatar name={user.name} color={user.avatar_color} size="lg" />}
                  </div>
                  <div className="stg-profile-hero__info">
                    <p className="stg-profile-hero__name">{user?.name}</p>
                    <p className="stg-profile-hero__sub">
                      {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
                      {user?.pod ? ` · ${POD_LABEL[user.pod] ?? user.pod}` : ''}
                    </p>
                  </div>
                </div>
                <div className="stg-fields-grid">
                  <div className="stg-field">
                    <p className="stg-field__label">Display name</p>
                    <p className="stg-field__value">{user?.name}</p>
                  </div>
                  <div className="stg-field">
                    <p className="stg-field__label">Email</p>
                    <p className="stg-field__value">{user?.email}</p>
                  </div>
                  <div className="stg-field">
                    <p className="stg-field__label">Role</p>
                    <p className="stg-field__value">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</p>
                  </div>
                  <div className="stg-field">
                    <p className="stg-field__label">Pod</p>
                    <p className="stg-field__value">{user?.pod ? POD_LABEL[user.pod] ?? user.pod : '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Notifications ── */}
            {section === 'notifications' && (
              <div className="stg-panel card">
                <h3 className="stg-panel__title">Notifications</h3>

                {/* General system toggles */}
                <p className="stg-notif-section-label">General</p>
                <div className="stg-notif-general">
                  {[
                    { key: 'capacity_warnings' as const, label: 'Capacity warnings', sub: 'Alerts when any pod exceeds 85%' },
                    { key: 'weekly_digest'     as const, label: 'Weekly digest',      sub: 'Every Monday, 9:00 am' },
                  ].map((item) => (
                    <div key={item.key} className="stg-toggle-row stg-toggle-row--compact">
                      <div>
                        <p className="stg-toggle-row__label">{item.label}</p>
                        <p className="stg-toggle-row__sub">{item.sub}</p>
                      </div>
                      <button
                        className={`stg-toggle${globalPrefs[item.key] ? ' stg-toggle--on' : ''}`}
                        onClick={() => toggleGlobal(item.key)}
                      >
                        <span className="stg-toggle__knob" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Per-client section (non-clients only) */}
                {user?.role !== 'client' && (
                  <>
                    <p className="stg-notif-section-label" style={{ marginTop: 28 }}>Client notifications</p>

                    {notifLoading && <p className="page-subtitle" style={{ padding: '12px 0' }}>Loading…</p>}

                    {!notifLoading && (
                      <>
                        {/* Admin: pod tabs */}
                        {user?.role === 'admin' && (
                          <div className="stg-pod-tabs" style={{ marginBottom: 12 }}>
                            {(['pod1', 'pod2'] as const).map((p) => (
                              <button
                                key={p}
                                className={`stg-pod-tab stg-pod-tab--${p}${notifPodTab === p ? ' stg-pod-tab--active' : ''}`}
                                onClick={() => setNotifPodTab(p)}
                              >
                                {POD_LABEL[p]}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Client tabs */}
                        {activeClients.length === 0 ? (
                          <p className="page-subtitle" style={{ padding: '8px 0 16px' }}>No clients found for this pod.</p>
                        ) : (
                          <div className="stg-client-tabs">
                            {activeClients.map((c) => (
                              <button
                                key={c.id}
                                className={`stg-client-tab${notifClientId === c.id ? ' stg-client-tab--active' : ''}`}
                                onClick={() => selectClient(c.id)}
                              >
                                {c.company_name || c.name}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Per-client toggles */}
                        {activeClientRow && (
                          <div className="stg-client-prefs">
                            <p className="stg-client-prefs__label">
                              {activeClientRow.company_name || activeClientRow.name}
                            </p>
                            {[
                              { key: 'approvals'  as const, label: 'Approval updates',   sub: 'When this client approves or rejects submitted work' },
                              { key: 'responses'  as const, label: 'Review responses',   sub: 'When this client responds to a review request' },
                              { key: 'comments'   as const, label: 'Comments',           sub: 'When this client adds a comment or note' },
                            ].map((item) => (
                              <div key={item.key} className="stg-toggle-row stg-toggle-row--compact">
                                <div>
                                  <p className="stg-toggle-row__label">{item.label}</p>
                                  <p className="stg-toggle-row__sub">{item.sub}</p>
                                </div>
                                <button
                                  className={`stg-toggle${clientPrefs[item.key] ? ' stg-toggle--on' : ''}`}
                                  onClick={() => toggleClientPref(item.key)}
                                >
                                  <span className="stg-toggle__knob" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Team & pods ── */}
            {section === 'team' && (
              <div className="stg-panel card">
                <h3 className="stg-panel__title">Team & pods</h3>

                {user?.role === 'admin' ? (
                  <div className="stg-pod-tabs">
                    {(['pod1', 'pod2'] as const).map((p) => (
                      <button
                        key={p}
                        className={`stg-pod-tab stg-pod-tab--${p}${podTab === p ? ' stg-pod-tab--active' : ''}`}
                        onClick={() => setPodTab(p)}
                      >
                        {POD_LABEL[p]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="stg-pod-badge-row">
                    <span className="stg-pod-badge stg-pod-badge--current">
                      Your pod: {user?.pod ? POD_LABEL[user.pod] ?? user.pod : 'No pod assigned'}
                    </span>
                  </div>
                )}

                {podLoading && <p className="page-subtitle" style={{ padding: '16px 0' }}>Loading members…</p>}
                {!podLoading && podMembers.length === 0 && (
                  <p className="page-subtitle" style={{ padding: '16px 0' }}>No team members found.</p>
                )}
                {!podLoading && podMembers.length > 0 && (
                  <div className="stg-members-list">
                    {podMembers.map((m: any) => (
                      <div key={m.user_id} className="stg-member-row">
                        <Avatar name={m.name} color={m.avatar_color} size="sm" />
                        <div className="stg-member-row__info">
                          <p className="stg-member-row__name">{m.name}</p>
                          <p className="stg-member-row__role">{ROLE_LABEL[m.role] ?? m.role}</p>
                        </div>
                        {m.pod && (
                          <span className={`stg-member-pod stg-member-pod--${m.pod}`}>
                            {POD_LABEL[m.pod] ?? m.pod}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Security ── */}
            {section === 'security' && (
              <div className="stg-panel card">
                <h3 className="stg-panel__title">Security</h3>
                <p className="stg-panel__desc">Change your account password below.</p>
                <div className="stg-pw-form">
                  {[
                    { key: 'current' as const, label: 'Current password',     placeholder: 'Enter current password' },
                    { key: 'next'    as const, label: 'New password',          placeholder: 'At least 6 characters' },
                    { key: 'confirm' as const, label: 'Confirm new password',  placeholder: 'Repeat new password' },
                  ].map((field) => (
                    <div key={field.key} className="stg-pw-field">
                      <label className="form-label">{field.label}</label>
                      <div className="stg-pw-input-wrap">
                        <input
                          type={showPw[field.key] ? 'text' : 'password'}
                          className="form-input"
                          placeholder={field.placeholder}
                          value={pwForm[field.key]}
                          onChange={(e) => setPwForm({ ...pwForm, [field.key]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
                        />
                        <button
                          type="button"
                          className="stg-pw-eye"
                          onClick={() => setShowPw({ ...showPw, [field.key]: !showPw[field.key] })}
                        >
                          {showPw[field.key] ? <RiEyeOffLine size={14} /> : <RiEyeLine size={14} />}
                        </button>
                      </div>
                    </div>
                  ))}
                  {pwMsg && (
                    <div className={`stg-pw-msg${pwMsg.ok ? ' stg-pw-msg--ok' : ' stg-pw-msg--err'}`}>
                      {pwMsg.ok && <RiCheckLine size={13} />} {pwMsg.text}
                    </div>
                  )}
                  <button className="btn-primary" style={{ marginTop: 4 }} disabled={pwSaving} onClick={submitPassword}>
                    {pwSaving ? 'Saving…' : 'Update password'}
                  </button>
                </div>
              </div>
            )}


          </div>
        </div>
      </div>
    </Layout>
  );
}
