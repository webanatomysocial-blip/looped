import { useEffect, useState } from 'react';
import { usersApi } from '../../services/api';

interface Props {
  userId: number;
  onClose: () => void;
}

interface Profile {
  id: number;
  name: string;
  role: string;
  categories: string | null;
  avatar_color: string;
  avatar_url: string | null;
  pod: string | null;
  pod_manager: string | null;
  overdue_tasks: number;
  achievements: number;
  certificates: string[];
  awards: string[];
}

const STAT_STYLE: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  gap: 2, flex: 1,
};

export default function EmployeeProfileModal({ userId, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    usersApi.getProfile(userId).then(r => setProfile(r.data)).catch(() => {});
  }, [userId]);

  const nameParts = (profile?.name ?? '').split(' ');
  const initials = nameParts.filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2);

  return (
    <>
      <style>{`
        @keyframes __ep-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes __ep-drop {
          0%   { opacity: 0; transform: translateY(-24px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes __ep-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
          animation: '__ep-backdrop 0.2s ease both',
        }}
      >
        {profile === null ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60 }}>
            <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: '__ep-spin 0.7s linear infinite' }} />
          </div>
        ) : null}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 550, borderRadius: 20,
            background: '#0f0f0f',
            boxShadow: '0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.07)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden',
            animation: '__ep-drop 0.3s cubic-bezier(0.34,1.1,0.64,1) both',
            display: profile === null ? 'none' : 'block',
          }}
        >
          {/* Header band */}
          <div style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', padding: '24px 22px 20px', position: 'relative' }}>
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                background: profile?.avatar_url ? 'transparent' : (profile?.avatar_color ?? '#555'),
                border: '2px solid rgba(255,255,255,0.15)',
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 700, color: '#fff',
              }}>
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                  {profile?.name ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3, textTransform: 'capitalize' }}>
                  {profile?.categories ?? profile?.role ?? 'Employee'}
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Info rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Row label="Pod Manager" value={profile?.pod_manager ?? '—'} />
              <Row label="Role" value={profile?.categories ?? (profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : '—')} />
              {profile?.pod && <Row label="Pod" value={profile.pod.toUpperCase()} />}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />

            {/* Stats */}
            <div style={{ display: 'flex', gap: 8 }}>
              <StatBox value={profile?.overdue_tasks ?? '—'} label="Overdue Tasks" color="#ef4444" />
              <StatBox value={profile?.achievements ?? '—'} label="Achievements" color="#22c55e" />
              <StatBox value="—" label="Certificates" color="#f59e0b" />
              <StatBox value="—" label="Awards" color="#a78bfa" />
            </div>

            {/* Certificates & Awards placeholders */}
            <div style={{ display: 'flex', gap: 8 }}>
              <EmptyBadge label="Certificates" />
              <EmptyBadge label="Awards" />
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 22px 18px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.5)', borderRadius: 99, padding: '6px 22px',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500, textAlign: 'right', maxWidth: 180 }}>{value}</span>
    </div>
  );
}

function StatBox({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{
      flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 10,
      padding: '10px 6px', textAlign: 'center',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4, lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

function EmptyBadge({ label }: { label: string }) {
  return (
    <div style={{
      flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8,
      padding: '10px 10px', border: '1px dashed rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>Coming soon</div>
    </div>
  );
}
