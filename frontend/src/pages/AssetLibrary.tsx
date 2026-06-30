import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { Upload, Download, Trash2, File, FileImage, FileText, Film } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import Avatar from '../components/UI/Avatar';
import { projectsApi, assetsApi } from '../services/api';
import { Asset, Project } from '../types';
import '../css/pages/AssetLibrary.css';

function FileIcon({ type }: { type: string | null }) {
  if (!type) return <File size={18} style={{ color: 'var(--ink-muted)' }} />;
  if (type.startsWith('image/')) return <FileImage size={18} style={{ color: '#6366f1' }} />;
  if (type.startsWith('video/')) return <Film size={18} style={{ color: 'var(--purple)' }} />;
  if (type.includes('pdf') || type.includes('text')) return <FileText size={18} style={{ color: 'var(--orange)' }} />;
  return <File size={18} style={{ color: 'var(--ink-muted)' }} />;
}

function fileSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssetLibrary() {
  const [assets, setAssets]     = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [uploadProject, setUploadProject] = useState('');
  const [uploadName, setUploadName]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([assetsApi.list(projectFilter ? Number(projectFilter) : undefined), projectsApi.list()])
      .then(([a, p]) => { setAssets(a.data); setProjects(p.data); })
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectFilter]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    if (uploadName) fd.append('name', uploadName);
    if (uploadProject) fd.append('project_id', uploadProject);
    try { await assetsApi.upload(fd); load(); setUploadName(''); setUploadProject(''); }
    catch (err: any) { alert(err.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this file?')) return;
    await assetsApi.delete(id);
    load();
  };

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 className="page-title">Asset Library</h2>
            <p className="page-subtitle">{assets.length} file{assets.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Upload bar */}
        <div className="assets-upload-bar">
          <input className="form-input" style={{ flex: 1, minWidth: 140 }} placeholder="Asset name (optional)" value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
          <select className="form-input" style={{ width: 180, flex: 'none' }} value={uploadProject} onChange={(e) => setUploadProject(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload file'}
          </button>
        </div>

        {/* Filter */}
        <div className="assets-filter-row">
          <select className="form-input" style={{ width: 200, background: 'var(--bg-white)' }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="assets-count">{assets.length} file{assets.length !== 1 ? 's' : ''}</span>
        </div>

        {loading && <p className="page-subtitle">Loading…</p>}

        <div className="assets-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {['File', 'Project', 'Uploaded by', 'Size', 'Date', ''].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <div className="asset-file-cell">
                      <div className="asset-file-icon">
                        <FileIcon type={asset.file_type} />
                      </div>
                      <span className="asset-file-name">{asset.name}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{asset.project_name || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={asset.uploaded_by_name} color={asset.avatar_color} size="sm" />
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{asset.uploaded_by_name}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{fileSize(asset.file_size)}</td>
                  <td style={{ fontSize: 12, color: 'var(--sand-border)' }}>{format(new Date(asset.created_at), 'MMM d, yyyy')}</td>
                  <td>
                    <div className="asset-actions">
                      <a href={assetsApi.downloadUrl(asset.id)} download className="icon-action" title="Download">
                        <Download size={12} />
                      </a>
                      <button onClick={() => handleDelete(asset.id)} className="icon-action danger" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {assets.length === 0 && !loading && (
                <tr><td colSpan={6} className="empty-state">No files uploaded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
