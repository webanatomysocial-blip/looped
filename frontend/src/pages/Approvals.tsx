import { useEffect, useState } from 'react';
import Pagination from '../components/UI/Pagination';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { approvalsApi } from '../services/api';
import { Approval } from '../types';
import ApprovalCard from '../components/approvals/ApprovalCard';
import { useApprovalActions } from '../components/approvals/useApprovalActions';
import '../css/pages/Approvals.css';

const PAGE_SIZE = 7;

export default function Approvals() {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<number | null>(null);

  const [podTab, setPodTab] = useState<'all' | 'pod1' | 'pod2'>('all');
  const [page, setPage]     = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [dateFilter, setDateFilter] = useState('');

  const actions = useApprovalActions({ onChanged: () => load(podTab) });

  const load = (pod?: string) => {
    setLoading(true);
    const podParam = user?.role === 'admin' ? (pod === 'all' ? undefined : pod) : undefined;
    approvalsApi.list(podParam).then((r) => {
      setApprovals(r.data);
      actions.seedTimers(r.data);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(podTab); }, [podTab]);

  const filtered = approvals.filter(a => {
    if (statusFilter === 'pending' && (a.status === 'approved' || a.status === 'rejected')) return false;
    if (statusFilter === 'approved' && a.status !== 'approved') return false;
    if (statusFilter === 'rejected' && a.status !== 'rejected') return false;
    if (dateFilter && a.created_at.slice(0, 10) !== dateFilter) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Layout>
      <div className="page-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 className="page-title">{user?.role === 'client' ? 'Pending Reviews' : 'Approvals'}</h2>
            <p className="page-subtitle">{filtered.length} of {approvals.length} item{approvals.length !== 1 ? 's' : ''}</p>
          </div>
          {user?.role === 'admin' && (
            <div className="filter-bar">
              {(['all', 'pod1', 'pod2'] as const).map((p) => (
                <button key={p} className={`filter-tab${podTab === p ? ' active' : ''}`}
                  onClick={() => { setPodTab(p); setPage(1); }}>
                  {p === 'all' ? 'All' : p === 'pod1' ? 'Pod 1' : 'Pod 2'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status + date filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="filter-bar">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
              <button key={s} className={`filter-tab${statusFilter === s ? ' active' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="date"
            className="form-input"
            style={{ width: 150, fontSize: 12, padding: '7px 12px' }}
            value={dateFilter}
            onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          />
          {dateFilter && (
            <button className="filter-tab" style={{ padding: '7px 10px', fontSize: 11 }}
              onClick={() => { setDateFilter(''); setPage(1); }}>✕</button>
          )}
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}
        {filtered.length === 0 && !loading && <div className="empty-state">No approvals at this stage</div>}

        <div className="approvals-list">
          {paginated.map((a) => (
            <ApprovalCard key={a.id} a={a} actions={actions}
              expanded={expanded === a.id}
              onToggle={() => setExpanded(expanded === a.id ? null : a.id)} />
          ))}
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>

      {actions.overlays}
    </Layout>
  );
}
