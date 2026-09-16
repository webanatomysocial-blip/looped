import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Pause } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import { capacityApi, tasksApi } from '../../services/api';
import '../../css/Layout/Layout.css';

function fmtSec(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

function GlobalTimer() {
  const [activeTask, setActiveTask] = useState<{ id: number; title: string; tracked: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const load = async () => {
    try {
      const r = await capacityApi.daily();
      const running = (r.data.tasks ?? []).find((t: any) => t.timer_running);
      if (running) {
        setActiveTask({ id: running.id, title: running.title, tracked: running.tracked_seconds_today });
        setElapsed(0);
      } else {
        setActiveTask(null);
      }
    } catch { /* silent */ }
  };

  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, []);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (activeTask) {
      tickRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeTask?.id]);

  // Don't show on home page (already has the flip clock)
  if (!activeTask || location.pathname === '/dashboard') return null;

  const liveSec = activeTask.tracked + elapsed;

  return (
    <div
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9000,
        background: '#1a1a1a', borderRadius: 16,
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => navigate('/dashboard')}
      title="Go to home"
    >
      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ea580c', flexShrink: 0, animation: 'timerPulse 1.2s ease-in-out infinite' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 11, color: '#888', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTask.title}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#e8e8e8', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtSec(liveSec)}</span>
      </div>
      <button
        onClick={async e => { e.stopPropagation(); await tasksApi.timer(activeTask.id, 'pause'); load(); }}
        style={{ background: '#ea580c', border: 'none', borderRadius: 10, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        title="Pause"
      >
        <Pause size={13} color="#fff" />
      </button>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__body">
        <Header />
        <main className="layout__main">{children}</main>
      </div>
      <GlobalTimer />
    </div>
  );
}
