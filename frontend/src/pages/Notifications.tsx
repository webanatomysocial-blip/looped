import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCheck, Bell, ThumbsUp, CheckSquare, MessageCircle } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import { notificationsApi } from '../services/api';
import { Notification } from '../types';
import '../css/pages/Notifications.css';

function NotifIcon({ type }: { type: string }) {
  if (type === 'approval') return <ThumbsUp size={16} />;
  if (type === 'task')     return <CheckSquare size={16} />;
  if (type === 'message')  return <MessageCircle size={16} />;
  return <Bell size={16} />;
}

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => { notificationsApi.list().then((r) => setNotifications(r.data)).finally(() => setLoading(false)); };
  useEffect(load, []);

  const markRead = async (id: number) => { await notificationsApi.markRead(id); load(); };
  const markAll  = async ()           => { await notificationsApi.markAllRead(); load(); };

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div className="notifs-header">
          <div>
            <h2 className="page-title">Notifications</h2>
            <p className="page-subtitle">{unread} unread</p>
          </div>
          {unread > 0 && (
            <button onClick={markAll} className="btn-secondary" style={{ fontSize: 12 }}>
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        {notifications.length === 0 && !loading && (
          <div className="notifs-empty">
            <Bell size={40} style={{ opacity: 0.2, margin: '0 auto' }} />
            <p>All caught up!</p>
          </div>
        )}

        <div className="notifs-list">
          {notifications.map((n) => (
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
                <p className="notif-time">{format(new Date(n.created_at), 'MMM d, h:mm a')}</p>
              </div>
              {!n.read && <div className="notif-unread-dot" />}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
