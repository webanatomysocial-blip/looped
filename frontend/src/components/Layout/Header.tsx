import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Settings, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi } from '../../services/api';
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

export default function Header({ action }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const prevUnread = useRef(-1);
  const audioCtx = useRef<AudioContext | null>(null);

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

  if (!user) return null;

  const initials = user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const firstName = user.name.split(' ')[0];

  return (
    <header className="app-header">
      <div className="app-header__left">
        <h1 className="app-header__greeting">Welcome, {firstName}</h1>
        <div className="app-header__meta">
          <span className="app-header__date">{formatDate()}</span>
          <span className="app-header__badge">{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</span>
        </div>
      </div>

      <div className="app-header__right">
        <div className="app-header__search">
          <Search size={14} />
          <span>Search tasks or client…</span>
        </div>

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
          style={{ backgroundColor: user.avatar_color }}
          title={user.name}
          onClick={() => navigate('/settings')}
        >
          {initials}
          <span className="app-header__online-dot" />
        </div>
      </div>
    </header>
  );
}
