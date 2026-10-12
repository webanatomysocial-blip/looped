import { useEffect, useState } from 'react';
import { categoriesApi } from '../../services/api';
import StageEditor, { Stage, Category } from './StageEditor';

interface FinalApproval { adminRequired: boolean; adminSkippable: boolean; clientOptional: boolean }
export interface CustomStages { name: string; stages: Stage[]; final_approval: FinalApproval }
const DEFAULT_FA: FinalApproval = { adminRequired: true, adminSkippable: true, clientOptional: true };

// Builds (or edits) the stages for the ticket being created. Kept in the form; saved only with that ticket.
export default function CustomStagesModal({ existing, needsApproval, onClose, onSaved }: {
  existing?: { name: string; stages: Stage[]; final_approval?: Partial<FinalApproval> } | null;
  needsApproval: boolean;
  onClose: () => void;
  onSaved: (custom: CustomStages) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState(existing?.name ?? '');
  const [stages, setStages] = useState<Stage[]>(existing?.stages ?? []);
  const [fa, setFa] = useState<FinalApproval>({ ...DEFAULT_FA, ...(existing?.final_approval ?? {}) });
  const [error, setError] = useState('');

  useEffect(() => { categoriesApi.list().then(r => setCategories(r.data)).catch(() => {}); }, []);

  const save = () => {
    if (!name.trim()) { setError('Give these stages a name.'); return; }
    if (stages.length === 0) { setError('Add at least one stage.'); return; }
    onSaved({ name: name.trim(), stages, final_approval: fa });
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Customise stages" style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{existing ? 'Edit custom stages' : 'Customise stages'}</h3>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
              These stages apply to this ticket only. They aren't saved as a template.
            </p>
          </div>
        </div>
        <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="form-label" htmlFor="custom-stages-name">Name</label>
            <input id="custom-stages-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Landing page + extra QA" autoFocus />
          </div>
          <div>
            <label className="form-label" style={{ marginBottom: 10 }}>Stages</label>
            <StageEditor stages={stages} categories={categories} onChange={setStages} />
          </div>
          <div>
            <label className="form-label">Final approval</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                ['adminRequired', 'Admin approval required'],
                ['adminSkippable', 'Manager can skip admin (send directly to client)'],
                ['clientOptional', 'Send to client for review'],
              ] as [keyof FinalApproval, string][]).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={fa[key]} onChange={e => setFa(f => ({ ...f, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {needsApproval && (
            <div style={{ fontSize: 12, color: '#92400e', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 12px' }}>
              Tickets with custom stages go to your pod manager first. They can approve it, edit it, or send it back to you.
            </div>
          )}
          {error && <p role="alert" style={{ fontSize: 12, color: 'var(--red)', margin: 0 }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save}>Use these stages</button>
        </div>
      </div>
    </div>
  );
}
