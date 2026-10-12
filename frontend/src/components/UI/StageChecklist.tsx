import { useEffect, useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { tasksApi } from '../../services/api';
import { forCurrentStage } from './ChecklistEditor';

// The checklist for the stage being worked/reviewed right now, tickable in place
export default function StageChecklist({ taskId, onChange }: { taskId: number; onChange?: (allDone: boolean) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    tasksApi.get(taskId)
      .then(r => setItems(forCurrentStage<any>(r.data.checklist || [], r.data).filter(i => i.text?.trim()).map(i => ({ ...i, completed: !!i.completed }))))
      .catch(() => setItems([]));
  }, [taskId]);

  useEffect(() => { if (items) onChange?.(items.every(i => i.completed)); }, [items]);

  if (!items || items.length === 0) return null;

  const toggle = async (id: number) => {
    const next = !items.find(i => i.id === id)!.completed;
    setError('');
    setItems(p => p!.map(i => (i.id === id ? { ...i, completed: next } : i)));
    try { await tasksApi.updateChecklist(taskId, id, next); }
    catch (e: any) {
      setItems(p => p!.map(i => (i.id === id ? { ...i, completed: !next } : i)));
      setError(e?.response?.data?.error || "Couldn't update this item");
    }
  };
  const done = items.filter(i => i.completed).length;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>
        Your checklist ({done}/{items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(i => (
          <button key={i.id} type="button" role="checkbox" aria-checked={i.completed} onClick={() => toggle(i.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
              border: `1.5px solid ${i.completed ? 'rgba(76,175,125,0.35)' : 'var(--sand-border)'}`, background: i.completed ? 'rgba(76,175,125,0.07)' : 'var(--surface, #fff)' }}>
            {i.completed ? <CheckSquare size={15} color="var(--green)" /> : <Square size={15} color="var(--ink-muted)" />}
            <span style={{ flex: 1 }}>{i.text}</span>
          </button>
        ))}
      </div>
      {done < items.length && <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>Tick every item before approving.</p>}
      {error && <p role="alert" style={{ fontSize: 12, color: '#dc2626', margin: '6px 0 0' }}>{error}</p>}
    </div>
  );
}
