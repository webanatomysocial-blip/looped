import { useRef } from 'react';

export type CheckItem = { text: string };

// Editable list of checklist items: type, Enter for the next one, × to remove
export default function ChecklistEditor({ items, onChange, label }: { items: CheckItem[]; onChange: (items: CheckItem[]) => void; label: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, text: string) => onChange(items.map((it, k) => (k === i ? { text } : it)));
  const add = (at = items.length) => {
    onChange([...items.slice(0, at), { text: '' }, ...items.slice(at)]);
    setTimeout(() => refs.current[at]?.focus(), 0);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>No checklist items for this stage.</p>}
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span aria-hidden style={{ width: 12, height: 12, border: '1.5px solid var(--sand-border)', borderRadius: 3, flexShrink: 0 }} />
          <input
            ref={el => { refs.current[i] = el; }}
            className="form-input"
            style={{ marginBottom: 0, padding: '6px 10px', fontSize: 12 }}
            placeholder={`${label} item ${i + 1}`}
            aria-label={`${label} checklist item ${i + 1}`}
            value={it.text}
            onChange={e => set(i, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(i + 1); } }}
          />
          <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={`Remove item ${i + 1}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', fontSize: 14, padding: '0 4px' }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => add()} style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, background: 'none', border: '1px dashed var(--sand-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', color: 'var(--ink)' }}>
        + Add item
      </button>
    </div>
  );
}

export const cleanItems = (items?: CheckItem[]) => (items || []).map(i => ({ text: (i.text || '').trim() })).filter(i => i.text);

// What the person working the task right now should see: whole-task items plus the current stage's own
export const forCurrentStage = <T extends { stage_idx?: number | null }>(items: T[], task: { ticket_type_id?: any; xlr8_stage_idx?: number | null }) =>
  !task?.ticket_type_id ? items : items.filter(i => i.stage_idx == null || Number(i.stage_idx) === (task.xlr8_stage_idx ?? 0));

export function StageTag({ name }: { name?: string | null }) {
  if (!name) return null;
  return <span style={{ fontSize: 10, fontWeight: 700, color: '#4f46e5', background: 'rgba(99,102,241,0.1)', borderRadius: 99, padding: '1px 7px', flexShrink: 0 }}>{name}</span>;
}
