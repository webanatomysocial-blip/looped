interface Props {
  name: string;
  role?: string;
  avatarUrl: string;
  onClose: () => void;
}

export default function IdCardModal({ name, role, avatarUrl, onClose }: Props) {
  const nameParts = name.split(' ');

  return (
    <>
      <style>{`
        @keyframes __id-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes __id-hang {
          0%   { opacity: 0; transform: translateY(-30px) rotate(-4deg); }
          60%  { transform: translateY(6px) rotate(1.5deg); }
          80%  { transform: translateY(-3px) rotate(-0.5deg); }
          100% { opacity: 1; transform: translateY(0) rotate(0deg); }
        }
        @keyframes __id-sway {
          0%,100% { transform: rotate(-1deg); }
          50%      { transform: rotate(1deg); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 3000,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(12px)',
          animation: '__id-backdrop 0.2s ease both',
        }}
      >
        {/* Hanging assembly */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            animation: '__id-hang 0.6s cubic-bezier(0.34,1.2,0.64,1) both',
            transformOrigin: 'top center',
          }}
        >
          {/* === STRAP === */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Clip at top — silver J-clip shape */}
            <div style={{
              width: 28, height: 38,
              background: 'linear-gradient(160deg, #e8e8e8 0%, #b0b0b0 45%, #d4d4d4 70%, #909090 100%)',
              borderRadius: '4px 4px 14px 14px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
              position: 'relative',
            }}>
              {/* clip hole */}
              <div style={{
                position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
                width: 12, height: 12, borderRadius: '50%',
                background: 'linear-gradient(135deg, #888 0%, #ccc 100%)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
              }} />
            </div>

            {/* Single lanyard strap with rotated text */}
            <div style={{
              width: 22,
              height: 90,
              background: '#111',
              borderRadius: '0 0 3px 3px',
              boxShadow: '2px 0 6px rgba(0,0,0,0.5), -2px 0 6px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <span style={{
                display: 'block',
                color: 'rgba(200,200,200,0.6)',
                fontSize: 8,
                fontWeight: 500,
                letterSpacing: '0.06em',
                fontFamily: 'system-ui, sans-serif',
                whiteSpace: 'nowrap',
                transform: 'rotate(-90deg)',
                userSelect: 'none',
              }}>Find clarity in chaos</span>
            </div>

            {/* Small connector nub into card */}
            <div style={{ width: 16, height: 10, background: '#222', borderRadius: '0 0 2px 2px' }} />
          </div>

          {/* === CARD === */}
          <div style={{
            width: 270,
            borderRadius: 16,
            background: '#111',
            boxShadow: '0 40px 100px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.07)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden',
          }}>
            {/* Name + role section */}
            <div style={{ padding: '22px 22px 14px' }}>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                {nameParts.map((part, i) => <div key={i}>{part}</div>)}
              </div>
              <div style={{ width: 80, height: 1.5, background: 'rgba(255,255,255,0.5)', margin: '10px 0 8px' }} />
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 400, textTransform: 'capitalize' }}>
                {role || 'Team Member'}
              </div>
            </div>

            {/* Photo — portrait, white bg, person with yellow glow like real card */}
            <div style={{
              margin: '0 16px',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#e8e8e8',
              aspectRatio: '3/4',
              position: 'relative',
            }}>
              <img
                src={avatarUrl}
                alt={name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top center',
                  display: 'block',
                  filter: 'grayscale(20%) contrast(1.05)',
                }}
              />
              {/* Yellow glow overlay at bottom — matches the real card's yellow highlight around the subject */}
              <div style={{
                position: 'absolute', inset: 0,
                boxShadow: 'inset 0 0 0 4px #f5c518, inset 0 0 30px rgba(245,197,24,0.15)',
                borderRadius: 10,
                pointerEvents: 'none',
              }} />
            </div>

            {/* Footer: WA logo */}
            <div style={{ padding: '14px 22px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
                <path d="M1 1 L5.5 13 L11 3.5 L16.5 13 L21 1" stroke="rgba(255,255,255,0.85)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                Web Anatomy
              </span>
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              marginTop: 20,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.55)',
              borderRadius: 99, padding: '6px 20px',
              fontSize: 12, cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.15s',
              fontFamily: 'system-ui, sans-serif',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
