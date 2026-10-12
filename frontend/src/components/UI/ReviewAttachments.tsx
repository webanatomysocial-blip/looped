import { useEffect, useState } from 'react';
import { Paperclip, Link2, ExternalLink } from 'lucide-react';
import { tasksApi } from '../../services/api';
import AttachmentMeta from './AttachmentMeta';

// What the worker submitted, shown at the top of a review so the reviewer can open it straight away
export default function ReviewAttachments({ taskId }: { taskId: number }) {
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    setItems(null);
    tasksApi.getDeliverables(taskId).then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, [taskId]);

  if (items === null) return <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 12px' }}>Loading attachments…</p>;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>
        Submitted attachments {items.length > 0 && `(${items.length})`}
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>Nothing was attached to this work.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((d) => (
            <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)', background: 'var(--surface, #fff)', color: 'var(--ink)', textDecoration: 'none', fontSize: 13 }}>
              {d.type === 'file' ? <Paperclip size={13} color="var(--ink-muted)" /> : <Link2 size={13} color="var(--ink-muted)" />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.url}</span>
                <AttachmentMeta d={d} />
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>Open <ExternalLink size={11} /></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
