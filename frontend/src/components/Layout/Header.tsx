import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Bell, Settings, Plus, Pause } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi, tasksApi, projectsApi, usersApi, capacityApi } from '../../services/api';
import IdCardModal from '../UI/IdCardModal';
import EmployeeProfileModal from '../UI/EmployeeProfileModal';
import '../../css/Layout/Header.css';

interface HeaderProps {
  /** Optional CTA button shown on the right (e.g. "New project") */
  action?: { label: string; onClick: () => void };
  /** @deprecated – greeting is always shown now; prop kept for compat */
  greeting?: boolean;
}

function formatDate() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtSec(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

export default function Header({ action }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const prevUnread = useRef(-1);
  const audioCtx = useRef<AudioContext | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ type: 'task' | 'project' | 'employee'; id: number; title: string; sub: string }[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Global timer pill
  const [activeTask, setActiveTask] = useState<{ id: number; title: string; tracked: number } | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadTimer = async () => {
    try {
      const r = await capacityApi.daily();
      const running = (r.data.tasks ?? []).find((t: any) => t.timer_running);
      if (running) { setActiveTask({ id: running.id, title: running.title, tracked: running.tracked_seconds_today }); setTimerElapsed(0); }
      else setActiveTask(null);
    } catch { /* silent */ }
  };
  useEffect(() => { loadTimer(); const iv = setInterval(loadTimer, 30000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (activeTask) tickRef.current = setInterval(() => setTimerElapsed(e => e + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeTask?.id]);

  // Create AudioContext lazily on first user gesture
  useEffect(() => {
    const init = () => {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
    };
    window.addEventListener('click', init, { once: true });
    window.addEventListener('keydown', init, { once: true });
    return () => {
      window.removeEventListener('click', init);
      window.removeEventListener('keydown', init);
    };
  }, []);

  const playNotifSound = async () => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') await ctx.resume();
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      g.connect(ctx.destination);
      [[880, 0], [1100, 0.15]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        osc.connect(g);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.4);
      });
    } catch {}
  };

  useEffect(() => {
    if (!user || user.role === 'client') return;
    const fetchCount = () => notificationsApi.unreadCount().then((r) => {
      const count = r.data.count;
      if (prevUnread.current !== -1 && count > prevUnread.current) {
        playNotifSound();
        window.dispatchEvent(new CustomEvent('wd:new-notification'));
      }
      prevUnread.current = count;
      setUnread(count);
    }).catch(() => {});
    fetchCount();
    const id = setInterval(fetchCount, 10000);  
    return () => clearInterval(id);
  }, [user]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setShowDrop(false); return; }
    debounceRef.current = setTimeout(async () => {
      const [tasksRes, projectsRes, teamRes] = await Promise.allSettled([tasksApi.list(), projectsApi.list(), usersApi.team()]);
      const q2 = q.toLowerCase();
      const taskItems = tasksRes.status === 'fulfilled'
        ? (tasksRes.value.data as any[])
            .filter((t: any) => t.title?.toLowerCase().includes(q2) || t.project_name?.toLowerCase().includes(q2) || t.client_name?.toLowerCase().includes(q2))
            .slice(0, 5)
            .map((t: any) => ({ type: 'task' as const, id: t.id, title: t.title, sub: t.project_name || '' }))
        : [];
      const projectItems = projectsRes.status === 'fulfilled'
        ? (projectsRes.value.data as any[])
            .filter((p: any) => p.name?.toLowerCase().includes(q2) || p.client_name?.toLowerCase().includes(q2))
            .slice(0, 5)
            .map((p: any) => ({ type: 'project' as const, id: p.id, title: p.name, sub: p.client_name || '' }))
        : [];
      const employeeItems = teamRes.status === 'fulfilled'
        ? (teamRes.value.data as any[])
            .filter((u: any) => u.name?.toLowerCase().includes(q2) || u.email?.toLowerCase().includes(q2))
            .slice(0, 4)
            .map((u: any) => ({ type: 'employee' as const, id: u.id, title: u.name, sub: u.role }))
        : [];
      setResults([...employeeItems, ...taskItems, ...projectItems]);
      setShowDrop(true);
    }, 300);
  };

  const goTo = (item: typeof results[0]) => {
    setShowDrop(false);
    setQuery('');
    setResults([]);
    if (item.type === 'employee') { setProfileUserId(item.id); return; }
    if (item.type === 'task') navigate('/tasks');
    else navigate('/projects');
  };

  if (!user) return null;

  const initials = user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const firstName = user.name.split(' ')[0];

  return (
    <>
    <header className="app-header">
      <div className="app-header__left">
        <h1 className="app-header__greeting">Welcome, {firstName}</h1>
        <div className="app-header__meta">
          <span className="app-header__date">{formatDate()}</span>
          <span className="app-header__badge">{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</span>
        </div>
      </div>

      <div className="app-header__right">
        <div className="app-header__search-wrap" ref={searchRef} style={{ position: 'relative' }}>
          <div className="app-header__search">
            <Search size={14} />
            <input
              className="app-header__search-input"
              placeholder="Search tasks or client…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => { if (results.length) setShowDrop(true); }}
            />
          </div>
          {showDrop && results.length > 0 && (
            <div className="app-header__search-drop">
              {results.map((item, i) => (
                <div key={i} className="app-header__search-item" onClick={() => goTo(item)}>
                  <span className="app-header__search-type" style={item.type === 'employee' ? { background: '#1e3a2e', color: '#4ade80' } : undefined}>{item.type}</span>
                  <span className="app-header__search-title">{item.title}</span>
                  {item.sub && <span className="app-header__search-sub">{item.sub}</span>}
                </div>
              ))}
            </div>
          )}
          {showDrop && query && results.length === 0 && (
            <div className="app-header__search-drop">
              <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--ink-muted)' }}>No results found</div>
            </div>
          )}
        </div>

        {/* Active timer pill — hidden on /dashboard which has its own flip clock */}
        {activeTask && location.pathname !== '/dashboard' && (() => {
          const liveSec = Math.floor(activeTask.tracked + timerElapsed);
          return (
            <div
              onClick={() => navigate('/dashboard')}
              title="Go to dashboard"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#1a1a1a', borderRadius: 20,
                padding: '6px 12px 6px 10px', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                userSelect: 'none', flexShrink: 0,
              }}
            >
              <div style={{ width: 7, height: 7, borderRadius: 4, background: '#ea580c', animation: 'timerPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1 }}>
                <span style={{ fontSize: 10, color: '#aaa', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTask.title}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtSec(liveSec)}</span>
              </div>
              <button
                onClick={async e => { e.stopPropagation(); await tasksApi.timer(activeTask.id, 'pause'); loadTimer(); }}
                style={{ background: '#ea580c', border: 'none', borderRadius: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                title="Pause"
              >
                <Pause size={11} color="#fff" />
              </button>
            </div>
          );
        })()}

        {action && (
          <button className="btn-primary" onClick={action.onClick}>
            <Plus size={14} />
            {action.label}
          </button>
        )}

        <button
          className="app-header__icon-btn"
          onClick={() => navigate('/notifications')}
          title="Notifications"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="app-header__badge-dot">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>

        <button
          className="app-header__icon-btn"
          onClick={() => navigate('/settings')}
          title="Settings"
        >
          <Settings size={16} />
        </button>

        <div
          className="app-header__avatar"
          style={{ backgroundColor: user.avatar_url ? 'transparent' : user.avatar_color, cursor: 'pointer' }}
          title={user.name}
          onClick={() => user.avatar_url ? setShowAvatarModal(true) : navigate('/settings')}
        >
          {user.avatar_url
            ? <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : initials}
          <span className="app-header__online-dot" />
        </div>
      </div>
    </header>

    {showAvatarModal && user.avatar_url && (
      <IdCardModal name={user.name} role={user.categories?.[0]?.name ?? user.role} avatarUrl={user.avatar_url} onClose={() => setShowAvatarModal(false)} />
    )}
    {profileUserId !== null && (
      <EmployeeProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    )}
    </>
  );
}
