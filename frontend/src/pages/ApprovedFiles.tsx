import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, Download } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import { approvalsApi } from '../services/api';
import { Approval } from '../types';
import '../css/pages/ApprovedFiles.css';

export default function ApprovedFiles() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    approvalsApi.list()
      .then((r) => setApprovals(r.data.filter((a: Approval) => a.status === 'approved')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div className="approved-header">
          <div>
            <h2 className="page-title">Approved Files</h2>
            <p className="page-subtitle">{approvals.length} approved item{approvals.length !== 1 ? 's' : ''}</p>
          </div>
          <span className="approved-count">{approvals.length} item{approvals.length !== 1 ? 's' : ''}</span>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        {approvals.length === 0 && !loading && (
          <div className="approved-empty">
            <CheckCircle size={40} style={{ opacity: 0.2, margin: '0 auto' }} />
            <p>No approved items yet</p>
          </div>
        )}

        <div className="approved-list">
          {approvals.map((a) => (
            <div key={a.id} className="approved-item">
              <div className="approved-item__icon">
                <CheckCircle size={18} />
              </div>
              <div className="approved-item__info">
                <p className="approved-item__title">{a.title}</p>
                <p className="approved-item__meta">
                  {a.project_name}{a.client_name ? ` · ${a.client_name}` : ''}
                  {a.final_approved_at ? ` · Approved ${format(new Date(a.final_approved_at), 'MMM d, yyyy')}` : ''}
                </p>
              </div>
              <span className="approved-item__badge">Approved</span>
              <a href="#" className="approved-item__download">
                <Download size={13} /> Download
              </a>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
