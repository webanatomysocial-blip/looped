import { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { CheckCheck, Bell, ThumbsUp, CheckSquare, MessageCircle } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Pagination from '../components/UI/Pagination';
import { notificationsApi } from '../services/api';
import { Notification } from '../types';
import '../css/pages/Notifications.css';

const PAGE_SIZE = 7;

function fmtDate(ts: string | null | undefined) {
  try { return ts ? format(new Date(ts), 'MMM d, h:mm a') : ''; } catch { return ''; }
}

function NotifIcon({ type }: { type: string }) {
  if (type === 'approval') return <ThumbsUp size={16} />;
  if (type === 'task')     return <CheckSquare size={16} />;
  if (type === 'message')  return <MessageCircle size={16} />;
  return <Bell size={16} />;
}

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<number | 'all'>('all');
  const [page, setPage] = useState(1);

  const load = () => {
    notificationsApi.list()
      .then((r) => setNotifications(Array.isArray(r.data) ? r.data : []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const markRead = async (id: number) => { await notificationsApi.markRead(id); load(); };
  const markAll  = async () => { await notificationsApi.markAllRead(); load(); };

  const projects = useMemo(() => {
    const seen = new Map<number, string>();
    for (const n of notifications) {
      if (n.project_id && n.project_name && !seen.has(n.project_id))
        seen.set(n.project_id, n.project_name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [notifications]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter((n) => n.project_id === activeTab);
  }, [notifications, activeTab]);

  const unread      = filtered.filter((n) => !n.read).length;
  const totalUnread = notifications.filter((n) => !n.read).length;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Layout>
      <div className="page-wrap">

        <div className="notifs-header">
          <div>
            <h2 className="page-title">Notifications</h2>
            <p className="page-subtitle">{totalUnread} unread</p>
          </div>
          {unread > 0 && (
            <button onClick={markAll} className="btn-secondary" style={{ fontSize: 12 }}>
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </div>

        {/* Project tabs */}
        <div className="notifs-tabs">
          <button
            className={`notifs-tab${activeTab === 'all' ? ' notifs-tab--active' : ''}`}
            onClick={() => { setActiveTab('all'); setPage(1); }}
          >
            All
            {totalUnread > 0 && <span className="notifs-tab__badge">{totalUnread}</span>}
          </button>
          {projects.map((p) => {
            const pUnread = notifications.filter((n) => n.project_id === p.id && !n.read).length;
            return (
              <button
                key={p.id}
                className={`notifs-tab${activeTab === p.id ? ' notifs-tab--active' : ''}`}
                onClick={() => { setActiveTab(p.id); setPage(1); }}
              >
                {p.name}
                {pUnread > 0 && <span className="notifs-tab__badge">{pUnread}</span>}
              </button>
            );
          })}
        </div>

        {loading && <p className="page-subtitle" style={{ padding: '12px 0' }}>Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="notifs-empty">
            <Bell size={40} style={{ opacity: 0.2, margin: '0 auto' }} />
            <p>{activeTab === 'all' ? 'All caught up!' : 'No notifications for this project'}</p>
          </div>
        )}

        <div className="notifs-list">
          {paginated.map((n) => (
            <div
              key={n.id}
              className={`notif-item${!n.read ? ' notif-item--unread' : ''}`}
              onClick={() => !n.read && markRead(n.id)}
              style={{ cursor: n.read ? 'default' : 'pointer' }}
            >
              <div className={`notif-icon notif-icon--${n.type || 'general'}`}>
                <NotifIcon type={n.type} />
              </div>
              <div className="notif-body">
                <p className="notif-message" style={{ opacity: n.read ? 0.65 : 1 }}>{n.message}</p>
                <p className="notif-time">
                  {n.project_name && activeTab === 'all' && (
                    <span className="notif-project-tag">{n.project_name} · </span>
                  )}
                  {fmtDate(n.created_at)}
                </p>
              </div>
              {!n.read && <div className="notif-unread-dot" />}
            </div>
          ))}
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
    </Layout>
  );
}
