import { AlertTriangle, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface UrgentTask {
  id: number;
  title: string;
  project_name?: string;
  due_date?: string | null;
  priority: 'high' | 'urgent';
  timer_running?: boolean;
}

interface Props {
  tasks: UrgentTask[];
  onDismiss: (id: number) => void;
}

const PRIORITY_STYLE = {
  urgent: {
    bg: 'rgba(220,38,38,0.07)',
    border: 'rgba(220,38,38,0.5)',
    badge: { bg: '#dc2626', color: '#fff' },
    icon: '#dc2626',
    label: 'URGENT',
  },
  high: {
    bg: 'rgba(234,88,12,0.07)',
    border: 'rgba(234,88,12,0.45)',
    badge: { bg: '#ea580c', color: '#fff' },
    icon: '#ea580c',
    label: 'HIGH PRIORITY',
  },
};

export default function UrgentTaskAlert({ tasks, onDismiss }: Props) {
  const navigate = useNavigate();
  if (tasks.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      {tasks.map(task => {
        const s = PRIORITY_STYLE[task.priority];
        return (
          <div key={task.id} style={{
            background: s.bg,
            border: `2px solid ${s.border}`,
            borderRadius: 14,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            boxShadow: `0 2px 12px ${s.border}`,
            animation: 'urgentPulse 2s ease-in-out',
          }}>
            {/* Icon */}
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              <AlertTriangle size={22} color={s.icon} style={{ animation: 'urgentShake 0.5s ease-in-out' }} />
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{
                  background: s.badge.bg, color: s.badge.color,
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                  padding: '2px 8px', borderRadius: 6,
                }}>
                  {s.label}
                </span>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.title}
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {task.project_name && <span>Project: <strong>{task.project_name}</strong></span>}
                {task.due_date && <span>Due: <strong>{task.due_date}</strong></span>}
                {task.timer_running === false && (
                  <span style={{ color: s.icon, fontWeight: 600 }}>⏸ Your previous task was auto-paused</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => navigate('/tasks')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: s.badge.bg, color: s.badge.color,
                  border: 'none', borderRadius: 8, padding: '7px 14px',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Go to task <ArrowRight size={13} />
              </button>
              <button
                onClick={() => onDismiss(task.id)}
                title="Dismiss"
                style={{
                  background: 'none', border: '1px solid var(--sand-border)',
                  borderRadius: 8, padding: '6px 8px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', color: 'var(--ink-muted)',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes urgentPulse {
          0% { transform: scale(0.98); opacity: 0.7; }
          50% { transform: scale(1.005); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes urgentShake {
          0%, 100% { transform: rotate(0deg); }
          20% { transform: rotate(-8deg); }
          40% { transform: rotate(8deg); }
          60% { transform: rotate(-5deg); }
          80% { transform: rotate(5deg); }
        }
      `}</style>
    </div>
  );
}
