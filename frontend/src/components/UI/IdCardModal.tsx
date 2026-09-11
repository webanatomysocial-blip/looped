interface Props {
  name: string;
  role?: string;
  avatarUrl: string;
  onClose: () => void;
}

export default function IdCardModal({ name, role, avatarUrl, onClose }: Props) {
  return (
    <>
      <style>{`
        @keyframes __id-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes __id-strap    { from { opacity: 0; transform: translateY(-24px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes __id-card     { from { opacity: 0; transform: scale(0.86) translateY(20px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes __id-swing    { 0%,100% { transform: rotate(-1.5deg) } 50% { transform: rotate(1.5deg) } }
      `}</style>

      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', animation: '__id-backdrop 0.2s ease both' }}>

        {/* Whole hanging assembly */}
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: '__id-card 0.4s cubic-bezier(0.34,1.46,0.64,1) both', transformOrigin: 'top center' }}>

          {/* Strap */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: '__id-strap 0.3s ease both' }}>
            {/* Lanyard loop going up (two strips) */}
            <div style={{ display: 'flex', gap: 6, height: 60 }}>
              <div style={{ width: 14, background: '#111', borderRadius: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
              <div style={{ width: 14, background: '#111', borderRadius: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
            </div>
            {/* Metal clip */}
            <div style={{ width: 36, height: 22, background: 'linear-gradient(180deg, #d0d0d0 0%, #a0a0a0 40%, #c8c8c8 100%)', borderRadius: 4, boxShadow: '0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 18, height: 10, background: 'linear-gradient(180deg, #b0b0b0 0%, #888 100%)', borderRadius: 2 }} />
            </div>
            {/* Horizontal strap label */}
            <div style={{ background: '#111', borderRadius: 3, padding: '4px 16px', marginTop: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              <span style={{ color: 'rgba(200,200,200,0.75)', fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap' }}>Find clarity in chaos</span>
            </div>
            {/* Short strap down to card */}
            <div style={{ width: 14, height: 16, background: '#111', borderRadius: '0 0 2px 2px', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }} />
          </div>

          {/* Card */}
          <div style={{
            width: 280, borderRadius: 18,
            background: '#111',
            boxShadow: '0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            {/* Top section: name + role */}
            <div style={{ padding: '22px 22px 16px' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                {name.split(' ').map((part, i) => <div key={i}>{part}</div>)}
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.3)', margin: '10px 0 8px' }} />
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 400, textTransform: 'capitalize' }}>{role || 'Team Member'}</div>
            </div>

            {/* Photo with yellow glow border */}
            <div style={{ margin: '0 14px', borderRadius: 12, overflow: 'hidden', background: '#fff', padding: 6, boxShadow: '0 0 0 3px #f5c518, 0 0 24px rgba(245,197,24,0.4)' }}>
              <img src={avatarUrl} alt={name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', objectPosition: 'top', borderRadius: 8, display: 'block', filter: 'grayscale(15%)' }} />
            </div>

            {/* Footer: WA logo */}
            <div style={{ padding: '14px 22px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {/* WA logomark */}
              <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
                <path d="M1 1 L5 13 L10 4 L15 13 L19 1" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Web Anatomy</span>
            </div>
          </div>

          {/* Close hint */}
          <button onClick={onClose} style={{ marginTop: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 99, padding: '6px 18px', fontSize: 12, cursor: 'pointer', backdropFilter: 'blur(4px)', transition: 'all 0.15s', fontFamily: 'system-ui, sans-serif' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}
