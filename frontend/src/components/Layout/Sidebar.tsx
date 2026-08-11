import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, CheckSquare, ThumbsUp, Package,
  BarChart2, Bell, MessageCircle, Users, Settings, LogOut, Mail,
  Sparkles, LayoutGrid, X, SearchCheck, Activity, FileCheck, Megaphone, Zap,
  MailPlus,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi } from '../../services/api';
import { Role } from '../../types';
import '../../css/Layout/Sidebar.css';

type NavItem = { to: string; icon: React.ElementType; label: string };
type NavGroup = { top: NavItem[]; more: NavItem[] };

const NAV: Record<Role, NavGroup> = {
  admin: {
    top: [
      { to: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/projects',       icon: FolderOpen,      label: 'Projects' },
      { to: '/tasks',          icon: CheckSquare,     label: 'Tasks' },
      { to: '/team-capacity',  icon: Activity,        label: 'Team Capacity' },
      { to: '/approvals',      icon: ThumbsUp,        label: 'Approvals' },
      { to: '/approved',       icon: FileCheck,       label: 'Approved' },
      { to: '/assets',         icon: Package,         label: 'Assets' },
    ],
    more: [
      { to: '/reports',         icon: BarChart2,      label: 'Reports' },
      { to: '/project-reports', icon: LayoutGrid,     label: 'Project Costs' },
      { to: '/xlr8',            icon: Zap,            label: 'XLR8' },
      { to: '/seo',             icon: SearchCheck,    label: 'SEO' },
      { to: '/ads',             icon: Megaphone,      label: 'Ads' },
      { to: '/messages',     icon: MessageCircle,  label: 'Messages' },
      { to: '/mail',         icon: Mail,           label: 'Mail' },
      { to: '/content',      icon: Sparkles,       label: 'Content AI' },
      { to: '/notifications',icon: Bell,           label: 'Notifications' },
      { to: '/admin/users',  icon: Users,          label: 'Users' },
      { to: '/contact-forms',icon: MailPlus,       label: 'Contact Forms' },
    ],
  },
  manager: {
    top: [
      { to: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/projects',       icon: FolderOpen,      label: 'Projects' },
      { to: '/tasks',          icon: CheckSquare,     label: 'Tasks' },
      { to: '/team-capacity',  icon: Activity,        label: 'Team Capacity' },
      { to: '/approvals',      icon: ThumbsUp,        label: 'Approvals' },
      { to: '/approved',       icon: FileCheck,       label: 'Approved' },
      { to: '/assets',         icon: Package,         label: 'Assets' },
    ],
    more: [
      { to: '/reports',         icon: BarChart2,      label: 'Reports' },
      { to: '/project-reports', icon: LayoutGrid,     label: 'Project Costs' },
      { to: '/xlr8',            icon: Zap,            label: 'XLR8' },
      { to: '/seo',             icon: SearchCheck,    label: 'SEO' },
      { to: '/ads',             icon: Megaphone,      label: 'Ads' },
      { to: '/messages',        icon: MessageCircle,  label: 'Messages' },
      { to: '/mail',            icon: Mail,           label: 'Mail' },
      { to: '/content',         icon: Sparkles,       label: 'Content AI' },
      { to: '/notifications',   icon: Bell,           label: 'Notifications' },
    ],
  },
  employee: {
    top: [
      { to: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/tasks',       icon: CheckSquare,     label: 'Tasks' },
      { to: '/approvals',   icon: ThumbsUp,        label: 'Approvals' },
      { to: '/approved',    icon: FileCheck,       label: 'Approved' },
      { to: '/assets',      icon: Package,         label: 'Assets' },
    ],
    more: [
      { to: '/seo',          icon: SearchCheck,    label: 'SEO' },
      { to: '/ads',          icon: Megaphone,      label: 'Ads' },
      { to: '/messages',     icon: MessageCircle,  label: 'Messages' },
      { to: '/mail',         icon: Mail,           label: 'Mail' },
      { to: '/content',      icon: Sparkles,       label: 'Content AI' },
      { to: '/notifications',icon: Bell,           label: 'Notifications' },
    ],
  },
  client: {
    top: [
      { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/projects',  icon: FolderOpen,    label: 'Projects' },
      { to: '/approvals', icon: ThumbsUp,      label: 'Reviews' },
      { to: '/approved',  icon: CheckSquare,   label: 'Approved' },
      { to: '/messages',  icon: MessageCircle, label: 'Messages' },
    ],
    more: [],
  },
};

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || user.role === 'client') return;
    const fetch = () => notificationsApi.unreadCount().then((r) => setUnread(r.data.count)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return null;

  const isSeoEmployee = user.role === 'employee'
    ? (user.categories?.some((c) => /seo/i.test(c.name)) ?? false)
    : true;
  const isAdsEmployee = user.role === 'employee'
    ? (user.categories?.some((c) => /ads/i.test(c.name)) ?? false)
    : true;

  const { top } = NAV[user.role];
  const more = NAV[user.role].more.filter(
    (item) => (item.to !== '/seo' || isSeoEmployee) && (item.to !== '/ads' || isAdsEmployee)
  );
  const initials = user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const renderItem = ({ to, icon: Icon, label }: NavItem) => {
    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    const hasNotif = label === 'Notifications' && unread > 0;
    return (
      <div
        key={to}
        style={{ position: 'relative' }}
        onMouseEnter={() => setTooltip(label)}
        onMouseLeave={() => setTooltip(null)}
      >
        <button
          onClick={() => navigate(to)}
          className={`sidebar__item${isActive ? ' active' : ''}`}
        >
          <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
          {hasNotif && <span className="sidebar__notif-dot" />}
        </button>
        {tooltip === label && <div className="sidebar__tooltip">{label}</div>}
      </div>
    );
  };

  // Check if current page is in the "more" group
  const moreIsActive = more.some(
    ({ to }) => location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
  );

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar__logo" onClick={() => navigate('/')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 6v6c0 5.1 3.5 9.8 8 11 4.5-1.2 8-5.9 8-11V6L12 2z" fill="white" opacity="0.9"/>
          <path d="M9 12l2 2 4-4" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Top nav */}
      <nav className="sidebar__nav">
        {top.map(renderItem)}

        {/* More apps trigger */}
        {more.length > 0 && (
          <div ref={moreRef} style={{ position: 'relative' }}>
            <div
              onMouseEnter={() => { if (!showMore) setTooltip('More'); }}
              onMouseLeave={() => setTooltip(null)}
            >
              <button
                onClick={() => { setShowMore((v) => !v); setTooltip(null); }}
                className={`sidebar__item${showMore || moreIsActive ? ' active' : ''}`}
                title="More"
              >
                {showMore ? <X size={18} strokeWidth={2} /> : <LayoutGrid size={18} strokeWidth={2} />}
              </button>
              {tooltip === 'More' && !showMore && <div className="sidebar__tooltip">More</div>}
            </div>

            {/* More panel */}
            {showMore && (
              <div className="sidebar__more-panel">
                <p className="sidebar__more-title">More apps</p>
                <div className="sidebar__more-grid">
                  {more.map(({ to, icon: Icon, label }) => {
                    const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
                    const hasNotif = label === 'Notifications' && unread > 0;
                    return (
                      <button
                        key={to}
                        className={`sidebar__more-item${isActive ? ' active' : ''}`}
                        onClick={() => { navigate(to); setShowMore(false); }}
                      >
                        <div className="sidebar__more-icon">
                          <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                          {hasNotif && <span className="sidebar__more-notif" />}
                        </div>
                        <span className="sidebar__more-label">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="sidebar__bottom">
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setTooltip('Settings')}
          onMouseLeave={() => setTooltip(null)}
        >
          <button
            onClick={() => navigate('/settings')}
            className={`sidebar__item${location.pathname === '/settings' ? ' active' : ''}`}
          >
            <Settings size={18} strokeWidth={2} />
          </button>
          {tooltip === 'Settings' && <div className="sidebar__tooltip">Settings</div>}
        </div>

        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setTooltip('Logout')}
          onMouseLeave={() => setTooltip(null)}
        >
          <button onClick={logout} className="sidebar__item sidebar__item--logout">
            <LogOut size={17} strokeWidth={2} />
          </button>
          {tooltip === 'Logout' && <div className="sidebar__tooltip">Logout</div>}
        </div>

        <div
          className="sidebar__avatar"
          style={{ backgroundColor: user.avatar_color }}
          title={user.name}
          onClick={() => navigate('/settings')}
        >
          {initials}
        </div>
      </div>
    </aside>
  );
}
