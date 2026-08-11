import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface Submission {
  id: number;
  formName: string;
  data: Record<string, string>;
  createdAt: string;
}

function csvEscape(value: unknown) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export default function ContactFormSubmissions() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [searchParams] = useSearchParams();

  const [project, setProject] = useState<{ id: number; name: string } | null>(null);
  const [forms, setForms] = useState<{ name: string }[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[] | null>(null);
  const [formName, setFormName] = useState(searchParams.get('formName') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    contactFormsApi.getProject(projectId).then((res) => setProject(res.data));
    contactFormsApi.listForms(projectId).then((res) => setForms(res.data));
    contactFormsApi.listSubmissions(projectId).then((res) => setAllSubmissions(res.data));
  }, [projectId]);

  const formNames = useMemo(() => {
    const names = new Set<string>();
    forms.forEach((f) => names.add(f.name));
    allSubmissions?.forEach((s) => names.add(s.formName));
    return Array.from(names).sort();
  }, [forms, allSubmissions]);

  const submissions = useMemo(() => {
    if (!allSubmissions) return null;
    return allSubmissions.filter((s) => {
      if (formName && s.formName !== formName) return false;
      const submittedAt = s.createdAt.slice(0, 10);
      if (from && submittedAt < from) return false;
      if (to && submittedAt > to) return false;
      return true;
    });
  }, [allSubmissions, formName, from, to]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    submissions?.forEach((s) => Object.keys(s.data).forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [submissions]);

  function downloadCsv() {
    if (!submissions) return;
    const header = ['Form', ...columns, 'Submitted At'];
    const rows = submissions.map((s) => [
      s.formName,
      ...columns.map((col) => s.data[col] ?? ''),
      new Date(s.createdAt).toLocaleString(),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name || 'submissions'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb
          items={[
            { label: 'Contact Forms', href: '/contact-forms' },
            { label: project?.name || '...', href: `/contact-forms/${projectId}` },
            { label: 'Submissions' },
          ]}
        />
        <div className="cf-header">
          <h1>Submissions</h1>
          <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!submissions?.length}>↓ Export CSV</button>
        </div>

        <div className="cf-filters">
          <select value={formName} onChange={(e) => setFormName(e.target.value)}>
            <option value="">All forms</option>
            {formNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="cf-filter-sep">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {submissions === null ? (
          <p className="cf-empty">Loading...</p>
        ) : submissions.length === 0 ? (
          <p className="cf-empty">No submissions match these filters.</p>
        ) : (
          <div className="cf-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Form</th>
                  {columns.map((col) => <th key={col}>{col}</th>)}
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.formName}</td>
                    {columns.map((col) => <td key={col}>{s.data[col] ?? ''}</td>)}
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
