import { Link } from 'react-router-dom';
import { Search, CheckCircle2, Circle, Link2, Paperclip, ArrowRight } from 'lucide-react';
import { tasksApi } from '../../services/api';

type ReviewData = { deliverables: any[]; checklist: any[] };

const ROLE_STYLE: Record<string, { label: string; color: string; bg: string; border: string; pill: string }> = {
  admin:    { label: 'Admin Review',   color: '#ea580c', bg: 'rgba(234,88,12,0.06)',  border: 'rgba(234,88,12,0.3)',  pill: 'rgba(234,88,12,0.1)'  },
  manager:  { label: 'Manager Review', color: '#7c3aed', bg: 'rgba(124,58,237,0.06)', border: 'rgba(124,58,237,0.3)', pill: 'rgba(124,58,237,0.1)' },
  employee: { label: 'Reviewer',       color: '#2563eb', bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.3)', pill: 'rgba(59,130,246,0.1)' },
};

interface Props {
  task: any;
  role: string;
  reviewData: ReviewData | undefined;
  onLoad: (taskId: number, data: ReviewData) => void;
}

export function ReviewAlert({ task, role, reviewData, onLoad }: Props) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.employee;

  if (!reviewData) {
    Promise.all([tasksApi.getDeliverables(task.id), tasksApi.get(task.id)])
      .then(([dr, tr]) => onLoad(task.id, { deliverables: dr.data, checklist: tr.data.checklist || [] }))
      .catch(() => {});
  }

  const delivs = reviewData?.deliverables || [];
  const links = delivs.filter((d: any) => d.type === 'link');
  const files = delivs.filter((d: any) => d.type === 'file');
  const checklist = reviewData?.checklist || [];

  return (
    <div style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={16} color={s.color} />
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Review required</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: s.pill, borderRadius: 99, padding: '2px 8px' }}>{s.label}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
        {task.title} <span style={{ fontWeight: 400, color: 'var(--ink-muted)', fontSize: 12 }}>· {task.project_name}</span>
      </div>
      {checklist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Checklist</div>
          {checklist.map((c: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)' }}>
              {c.completed ? <CheckCircle2 size={12} color="var(--green)" /> : <Circle size={12} color="var(--ink-muted)" />}
              {c.text}
            </div>
          ))}
        </div>
      )}
      {(links.length > 0 || files.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Deliverables</div>
          {links.map((d: any) => (
            <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: s.color, textDecoration: 'underline' }}>
              <Link2 size={11} /> {d.name || d.url}
            </a>
          ))}
          {files.map((d: any) => (
            <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: s.color, textDecoration: 'underline' }}>
              <Paperclip size={11} /> {d.name}
            </a>
          ))}
        </div>
      )}
      <Link to="/approvals" style={{ alignSelf: 'flex-start', background: s.color, color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
        Go to Approvals <ArrowRight size={13} />
      </Link>
    </div>
  );
}
