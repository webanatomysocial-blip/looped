import { useEffect, useState } from 'react';
import { xlr8Api } from '../../services/api';

type Stage = { idx: number; name: string; assignee: string | null };

// Lets a reviewer choose which earlier stage the work goes back to; flow then continues forward from it.
export default function SendBackStagePicker({ ticketId, value, onChange }: { ticketId: number; value: number | null; onChange: (idx: number | null) => void }) {
  const [stages, setStages] = useState<Stage[] | null>(null);

  useEffect(() => {
    setStages(null);
    xlr8Api.returnStages(ticketId)
      .then((r) => {
        setStages(r.data);
        if (r.data.length) onChange(r.data[r.data.length - 1].idx);
      })
      .catch(() => setStages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  if (stages === null) return <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Loading stages…</p>;
  if (stages.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <label className="form-label">Send back to stage</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stages.map((s) => {
          const active = value === s.idx;
          return (
            <button
              key={s.idx}
              type="button"
              onClick={() => onChange(s.idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${active ? 'var(--red)' : 'var(--sand-border, #e5e7eb)'}`,
                background: active ? 'rgba(220,38,38,0.06)' : 'transparent',
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: active ? 'var(--red)' : 'var(--bg-sand, #f1f5f9)', color: active ? '#fff' : 'var(--ink-muted)' }}>{s.idx + 1}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-muted)' }}>{s.assignee ?? 'Unassigned — manager will assign'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>Work restarts at this stage and moves through every stage after it again.</p>
    </div>
  );
}
