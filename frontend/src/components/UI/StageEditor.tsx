import { useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiArrowUpLine, RiArrowDownLine } from 'react-icons/ri';
import ChecklistEditor, { CheckItem } from './ChecklistEditor';

export interface Stage { type?: 'employee' | 'manager' | 'admin'; category_id?: number; category_name?: string; est_hours?: number; reviewer?: boolean; checklist?: CheckItem[] }
export interface Category { id: number; name: string }

// Ordered stage list: pick a category (or Admin Review) per stage, toggle reviewer, reorder, remove, add.
export default function StageEditor({ stages, categories, onChange }: { stages: Stage[]; categories: Category[]; onChange: (stages: Stage[]) => void }) {
  const set = (i: number, stage: Stage) => { const s = [...stages]; s[i] = stage; onChange(s); };
  const [openList, setOpenList] = useState<number | null>(null);

  const addStage = () => {
    const cat = categories.find(c => !stages.find(s => s.category_id === c.id)) || categories[0];
    if (!cat) return;
    onChange([...stages, { type: 'employee', category_id: cat.id, category_name: cat.name }]);
  };

  const moveStage = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= stages.length) return;
    const s = [...stages];
    [s[i], s[to]] = [s[to], s[i]];
    onChange(s);
  };

  return (
    <div>
      {stages.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>No stages — ticket goes straight to final approval.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stages.map((s, i) => {
          const isEmployee = s.type !== 'admin';
          const bg = s.type === 'admin' ? 'var(--surface-raised, #fff4f0)' : s.reviewer ? 'var(--surface-raised, #f0fdf4)' : 'var(--surface-raised, #f8f8f8)';
          const dropVal = s.type === 'admin' ? 'admin' : String(s.category_id ?? '');
          const handleDrop = (val: string) => {
            if (val === 'admin') { set(i, { type: 'admin', checklist: s.checklist }); return; }
            const cat = categories.find(c => c.id === Number(val));
            if (cat) set(i, { type: 'employee', category_id: cat.id, category_name: cat.name, checklist: s.checklist });
          };
          return (
            <div key={i} style={{ padding: '10px 12px', background: bg, borderRadius: 8, border: `1px solid ${isEmployee && s.reviewer ? '#bbf7d0' : 'var(--sand-border)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', width: 20, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
              <select className="form-input" value={dropVal} onChange={e => handleDrop(e.target.value)} style={{ flex: 1, minWidth: 0, marginBottom: 0 }} aria-label={`Stage ${i + 1}`}>
                {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                <option value="admin">Admin Review</option>
              </select>
              {isEmployee && (
                <button
                  type="button"
                  onClick={() => set(i, { ...s, reviewer: !s.reviewer })}
                  title="Toggle Reviewer mode — employee acts as a reviewer for this stage"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: `1.5px solid ${s.reviewer ? '#22c55e' : 'var(--sand-border)'}`, background: s.reviewer ? '#dcfce7' : 'transparent', color: s.reviewer ? '#16a34a' : 'var(--ink-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <span style={{ width: 26, height: 14, borderRadius: 99, background: s.reviewer ? '#22c55e' : '#cbd5e1', position: 'relative', display: 'inline-block', flexShrink: 0, transition: 'background 0.15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: s.reviewer ? 14 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                  </span>
                  Reviewer
                </button>
              )}
              <button type="button" onClick={() => setOpenList(openList === i ? null : i)} aria-expanded={openList === i}
                title="Checklist only the person on this stage sees"
                style={{ padding: '4px 10px', borderRadius: 6, border: `1.5px solid ${s.checklist?.length ? '#6366f1' : 'var(--sand-border)'}`, background: openList === i ? 'rgba(99,102,241,0.08)' : 'transparent', color: s.checklist?.length ? '#4f46e5' : 'var(--ink-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                ☑ Checklist{s.checklist?.length ? ` (${s.checklist.length})` : ''}
              </button>
              <button type="button" className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => moveStage(i, -1)} disabled={i === 0} aria-label="Move up"><RiArrowUpLine /></button>
              <button type="button" className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} aria-label="Move down"><RiArrowDownLine /></button>
              <button type="button" className="btn-ghost" style={{ padding: '4px 8px', color: 'var(--red)' }} onClick={() => onChange(stages.filter((_, idx) => idx !== i))} aria-label="Remove stage"><RiDeleteBinLine /></button>
            </div>
            {openList === i && (
              <div style={{ marginTop: 10, paddingLeft: 28 }}>
                <ChecklistEditor items={s.checklist || []} onChange={items => set(i, { ...s, checklist: items })} label={s.type === 'admin' ? 'Admin review' : s.category_name || `Stage ${i + 1}`} />
              </div>
            )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addStage}>
          <RiAddLine style={{ marginRight: 4 }} />Add Stage
        </button>
      </div>
    </div>
  );
}
