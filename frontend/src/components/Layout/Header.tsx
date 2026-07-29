import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!user || user.role === 'client') return;
    const fetch = () => notificationsApi.unreadCount().then((r) => setUnread(r.data.count)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 30000);
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
