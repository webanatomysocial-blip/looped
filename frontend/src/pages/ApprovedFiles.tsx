import { useEffect, useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, isWithinInterval } from 'date-fns';
import { CheckCircle, Download, Filter } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Pagination from '../components/UI/Pagination';

const PAGE_SIZE = 7;
import { approvalsApi } from '../services/api';
import { Approval } from '../types';
import '../css/pages/ApprovedFiles.css';

function downloadCertificate(a: Approval) {
  const approvedDate = a.final_approved_at
    ? format(new Date(a.final_approved_at), 'MMMM d, yyyy')
    : format(new Date(a.created_at), 'MMMM d, yyyy');

  const lines = [
    '============================================',
    '          APPROVAL CERTIFICATE',
    '============================================',
    '',
    `Task:      ${a.title}`,
    `Project:   ${a.project_name}`,
    ...(a.client_name ? [`Client:    ${a.client_name}`] : []),
    `Submitted: ${a.submitted_by_name}`,
    `Approved:  ${approvedDate}`,
    `Status:    APPROVED`,
    '',
    '============================================',
  ].join('\n');

  const blob = new Blob([lines], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href  = url;
  link.download = `approved-${a.title.replace(/\s+/g, '-').toLowerCase()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

const DATE_RANGES = [
  { key: 'all',        label: 'All time' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year',  label: 'This year' },
] as const;
type DateRangeKey = typeof DATE_RANGES[number]['key'];

function getDateInterval(key: DateRangeKey): { start: Date; end: Date } | null {
  const now = new Date();
  if (key === 'this_month') return { start: startOfMonth(now), end: endOfMonth(now) };
  if (key === 'last_month') { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
  if (key === 'this_year')  return { start: startOfYear(now), end: now };
  return null;
}

export default function ApprovedFiles() {
  const [all, setAll]           = useState<Approval[]>([]);
  const [loading, setLoading]   = useState(true);
  const [projectFilter, setProjectFilter] = useState('all');
  const [dateFilter, setDateFilter]       = useState<DateRangeKey>('all');
  const [exactDate, setExactDate]         = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    approvalsApi.list()
      .then((r) => setAll(r.data.filter((a: Approval) => a.status === 'approved')))
      .finally(() => setLoading(false));
  }, []);

  // Unique projects from approved list
  const projects = useMemo(() => {
    const seen = new Set<string>();
    return all
      .filter(a => { if (seen.has(a.project_name)) return false; seen.add(a.project_name); return true; })
      .map(a => ({ id: String(a.project_id), name: a.project_name }));
  }, [all]);

  const filtered = useMemo(() => {
    let list = all;
    if (projectFilter !== 'all') list = list.filter(a => String(a.project_id) === projectFilter);
    if (exactDate) {
      list = list.filter(a => {
        const d = a.final_approved_at ?? a.created_at;
        return d.slice(0, 10) === exactDate;
      });
    } else {
      const interval = getDateInterval(dateFilter);
      if (interval) {
        list = list.filter(a => {
          const d = a.final_approved_at ? new Date(a.final_approved_at) : new Date(a.created_at);
          return isWithinInterval(d, interval);
        });
      }
    }
    return list;
  }, [all, projectFilter, dateFilter, exactDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Layout>
      <div className="page-wrap">

        <div className="approved-header">
          <div>
            <h2 className="page-title">Approved Files</h2>
            <p className="page-subtitle">
              {filtered.length} of {all.length} approved item{all.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="approved-filters">
          <div className="approved-filter-group">
            <Filter size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
            <select
              className="approved-filter-select"
              value={projectFilter}
              onChange={e => { setProjectFilter(e.target.value); setPage(1); }}
            >
              <option value="all">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="approved-filter-group">
            <select
              className="approved-filter-select"
              value={exactDate ? '' : dateFilter}
              onChange={e => { setDateFilter(e.target.value as DateRangeKey); setExactDate(''); setPage(1); }}
            >
              {DATE_RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>

          <div className="approved-filter-group">
            <input
              type="date"
              className="approved-filter-select"
              style={{ cursor: 'pointer' }}
              value={exactDate}
              onChange={e => { setExactDate(e.target.value); setDateFilter('all'); setPage(1); }}
            />
          </div>

          {(projectFilter !== 'all' || dateFilter !== 'all' || exactDate) && (
            <button
              className="approved-filter-clear"
              onClick={() => { setProjectFilter('all'); setDateFilter('all'); setExactDate(''); setPage(1); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="approved-empty">
            <CheckCircle size={40} style={{ opacity: 0.2, margin: '0 auto' }} />
            <p>{all.length === 0 ? 'No approved items yet' : 'No items match the selected filters'}</p>
          </div>
        )}

        <div className="approved-list">
          {paginated.map((a) => {
            const approvedAt = a.final_approved_at ?? a.created_at;
            return (
              <div key={a.id} className="approved-item card">
                <div className="approved-item__icon">
                  <CheckCircle size={18} />
                </div>
                <div className="approved-item__info">
                  <p className="approved-item__title">{a.title}</p>
                  <p className="approved-item__meta">
                    <span className="approved-item__project">{a.project_name}</span>
                    {a.client_name && <span> · {a.client_name}</span>}
                    <span> · Approved {format(new Date(approvedAt), 'MMM d, yyyy')}</span>
                    {a.submitted_by_name && <span> · by {a.submitted_by_name}</span>}
                  </p>
                </div>
                <span className="approved-item__badge">Approved</span>
                <button className="approved-item__download" onClick={() => downloadCertificate(a)}>
                  <Download size={13} /> Download
                </button>
              </div>
            );
          })}
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
    </Layout>
  );
}
