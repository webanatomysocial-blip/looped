import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  RiDashboardLine, RiFolderOpenLine, RiCheckboxLine, RiThumbUpLine,
  RiArchiveLine, RiBarChart2Line, RiBellLine, RiChat1Line,
  RiGroupLine, RiSettings4Line, RiLogoutBoxRLine, RiMailLine,
  RiMagicLine, RiLayoutGridLine, RiCloseLine, RiSearchEyeLine,
  RiHeartPulseLine, RiFileCheckLine, RiMegaphoneLine, RiLightbulbFlashLine,
  RiMailAddLine, RiMapPin2Line,
} from 'react-icons/ri';
import { useAuth } from '../../contexts/AuthContext';
import { notificationsApi } from '../../services/api';
import { Role } from '../../types';
import '../../css/Layout/Sidebar.css';

type NavItem = { to: string; icon: React.ElementType; label: string };
type NavGroup = { top: NavItem[]; more: NavItem[] };

const NAV: Record<Role, NavGroup> = {
  admin: {
    top: [
      { to: '/dashboard',          icon: RiDashboardLine,  label: 'Dashboard' },
      { to: '/projects',           icon: RiFolderOpenLine, label: 'Projects' },
      { to: '/tasks',              icon: RiCheckboxLine,   label: 'Tasks' },
      { to: '/team-capacity',      icon: RiHeartPulseLine, label: 'Team Capacity' },
      { to: '/approvals',          icon: RiThumbUpLine,    label: 'Approvals' },
      { to: '/approved',           icon: RiFileCheckLine,  label: 'Approved' },
      { to: '/assets',             icon: RiArchiveLine,    label: 'Assets' },
    ],
    more: [
      { to: '/reports',            icon: RiBarChart2Line,  label: 'Reports' },
      { to: '/project-reports',    icon: RiLayoutGridLine, label: 'Project Costs' },
      { to: '/xlr8',               icon: RiLightbulbFlashLine, label: 'XLR8' },
      { to: '/seo',                icon: RiSearchEyeLine,  label: 'SEO' },
      { to: '/local-seo',          icon: RiMapPin2Line,    label: 'Local SEO' },
      { to: '/ads',                icon: RiMegaphoneLine,  label: 'Ads' },
      { to: '/messages',           icon: RiChat1Line,      label: 'Messages' },
      { to: '/mail',               icon: RiMailLine,       label: 'Mail' },
      { to: '/content',            icon: RiMagicLine,      label: 'Content AI' },
      { to: '/notifications',      icon: RiBellLine,       label: 'Notifications' },
      { to: '/admin/users',        icon: RiGroupLine,      label: 'Users' },
      { to: '/contact-forms',      icon: RiMailAddLine,    label: 'Contact Forms' },
    ],
  },
  manager: {
    top: [
      { to: '/dashboard',          icon: RiDashboardLine,  label: 'Dashboard' },
      { to: '/projects',           icon: RiFolderOpenLine, label: 'Projects' },
      { to: '/tasks',              icon: RiCheckboxLine,   label: 'Tasks' },
      { to: '/team-capacity',      icon: RiHeartPulseLine, label: 'Team Capacity' },
      { to: '/approvals',          icon: RiThumbUpLine,    label: 'Approvals' },
      { to: '/approved',           icon: RiFileCheckLine,  label: 'Approved' },
      { to: '/assets',             icon: RiArchiveLine,    label: 'Assets' },
    ],
    more: [
      { to: '/seo',                icon: RiSearchEyeLine,  label: 'SEO' },
      { to: '/local-seo',          icon: RiMapPin2Line,    label: 'Local SEO' },
      { to: '/ads',                icon: RiMegaphoneLine,  label: 'Ads' },
      { to: '/messages',           icon: RiChat1Line,      label: 'Messages' },
      { to: '/mail',               icon: RiMailLine,       label: 'Mail' },
      { to: '/content',            icon: RiMagicLine,      label: 'Content AI' },
      { to: '/contact-forms',      icon: RiMailAddLine,    label: 'Contact Forms' },
      { to: '/notifications',      icon: RiBellLine,       label: 'Notifications' },
    ],
  },
  employee: {
    top: [
      { to: '/dashboard',          icon: RiDashboardLine,  label: 'Dashboard' },
      { to: '/tasks',              icon: RiCheckboxLine,   label: 'Tasks' },
      { to: '/approvals',          icon: RiThumbUpLine,    label: 'Approvals' },
      { to: '/approved',           icon: RiFileCheckLine,  label: 'Approved' },
      { to: '/assets',             icon: RiArchiveLine,    label: 'Assets' },
    ],
    more: [
      { to: '/seo',                icon: RiSearchEyeLine,  label: 'SEO' },
      { to: '/ads',                icon: RiMegaphoneLine,  label: 'Ads' },
      { to: '/messages',           icon: RiChat1Line,      label: 'Messages' },
      { to: '/mail',               icon: RiMailLine,       label: 'Mail' },
      { to: '/content',            icon: RiMagicLine,      label: 'Content AI' },
      { to: '/contact-forms',      icon: RiMailAddLine,    label: 'Contact Forms' },
      { to: '/notifications',      icon: RiBellLine,       label: 'Notifications' },
    ],
  },
  client: {
    top: [
      { to: '/dashboard',          icon: RiDashboardLine,  label: 'Dashboard' },
      { to: '/projects',           icon: RiFolderOpenLine, label: 'Projects' },
      { to: '/approvals',          icon: RiThumbUpLine,    label: 'Reviews' },
      { to: '/approved',           icon: RiCheckboxLine,   label: 'Approved' },
      { to: '/messages',           icon: RiChat1Line,      label: 'Messages' },
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
          <Icon size={18} />
          {hasNotif && <span className="sidebar__notif-dot" />}
        </button>
        {tooltip === label && <div className="sidebar__tooltip">{label}</div>}
      </div>
    );
  };

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
                {showMore ? <RiCloseLine size={18} /> : <RiLayoutGridLine size={18} />}
              </button>
              {tooltip === 'More' && !showMore && <div className="sidebar__tooltip">More</div>}
            </div>

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
                          <Icon size={20} />
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
            <RiSettings4Line size={18} />
          </button>
          {tooltip === 'Settings' && <div className="sidebar__tooltip">Settings</div>}
        </div>

        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setTooltip('Logout')}
          onMouseLeave={() => setTooltip(null)}
        >
          <button onClick={logout} className="sidebar__item sidebar__item--logout">
            <RiLogoutBoxRLine size={17} />
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
