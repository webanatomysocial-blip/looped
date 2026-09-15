import { useEffect, useState, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { ChevronRight, Home, Plus, Upload, Download, Trash2, FolderPlus, Edit2, X } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { assetsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import '../css/pages/AssetLibrary.css';

// ─── Windows-style SVG folder icon ───────────────────────────────────────────
function FolderIcon({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 100 80" fill="none">
      <path d="M4 16C4 11.6 7.6 8 12 8H38L46 20H88C92.4 20 96 23.6 96 28V68C96 72.4 92.4 76 88 76H12C7.6 76 4 72.4 4 68V16Z" fill="#F4C430"/>
      <path d="M4 28H96V68C96 72.4 92.4 76 88 76H12C7.6 76 4 72.4 4 68V28Z" fill="#FFD700"/>
      <path d="M4 24C4 21.8 5.8 20 8 20H92C94.2 20 96 21.8 96 24V30H4V24Z" fill="#FFC200"/>
    </svg>
  );
}

function ImageThumb({ id, name }: { id: number; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(assetsApi.downloadUrl(id), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(b => setSrc(URL.createObjectURL(b)))
      .catch(() => {});
    return () => { if (src) URL.revokeObjectURL(src); };
  }, [id]);
  if (!src) return <span style={{ fontSize: 48 }}>🖼️</span>;
  return (
    <img
      src={src}
      alt={name}
      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
    />
  );
}

function FileTypeIcon({ type }: { type: string | null }) {
  const s = type ?? '';
  if (s.startsWith('image/')) return <span style={{ fontSize: 48 }}>🖼️</span>;
  if (s.startsWith('video/')) return <span style={{ fontSize: 48 }}>🎬</span>;
  if (s.includes('pdf')) return <span style={{ fontSize: 48 }}>📕</span>;
  if (s.includes('word') || s.includes('document')) return <span style={{ fontSize: 48 }}>📝</span>;
  if (s.includes('sheet') || s.includes('excel')) return <span style={{ fontSize: 48 }}>📊</span>;
  if (s.includes('zip')) return <span style={{ fontSize: 48 }}>🗜️</span>;
  return <span style={{ fontSize: 48 }}>📄</span>;
}

function fileSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FolderRow { id: number; name: string }
interface FileRow { id: number; name: string; file_type: string | null; file_size: number | null; created_at: string; uploaded_by_name: string }
interface ProjectRow { id: number; name: string; file_count: number }

type View =
  | { kind: 'root' }
  | { kind: 'project'; projectId: string; projectName: string; folderId: number | null; breadcrumb: { id: number; name: string }[] };

export default function AssetLibrary() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [view, setView] = useState<View>({ kind: 'root' });
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [noProjectCount, setNoProjectCount] = useState(0);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Rename / new folder inline state
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: 'folder' | 'file'; id: number; name: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view.kind === 'root') {
        const r = await assetsApi.browse();
        setProjects(r.data.projects ?? []);
        setNoProjectCount(r.data.no_project_count ?? 0);
        setFolders([]); setFiles([]);
      } else {
        const r = await assetsApi.browse(view.projectId, view.folderId);
        setFolders(r.data.folders ?? []);
        setFiles(r.data.files ?? []);
      }
    } finally { setLoading(false); }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  // Close context menu on click outside
  useEffect(() => {
    const h = () => setCtxMenu(null);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  const openProject = (id: string | number, name: string) => {
    setView({ kind: 'project', projectId: String(id), projectName: name, folderId: null, breadcrumb: [] });
  };

  const openFolder = (f: FolderRow) => {
    if (view.kind !== 'project') return;
    setView({
      ...view,
      folderId: f.id,
      breadcrumb: [...view.breadcrumb, { id: f.id, name: f.name }],
    });
  };

  const navBreadcrumb = (idx: number) => {
    if (view.kind !== 'project') return;
    if (idx === -1) { setView({ ...view, folderId: null, breadcrumb: [] }); return; }
    const crumb = view.breadcrumb[idx];
    setView({ ...view, folderId: crumb.id, breadcrumb: view.breadcrumb.slice(0, idx + 1) });
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || view.kind !== 'project') return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', file.name);
        if (view.projectId !== 'none') fd.append('project_id', view.projectId);
        if (view.folderId) fd.append('folder_id', String(view.folderId));
        await assetsApi.upload(fd);
      }
      load();
    } catch { alert('Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || view.kind !== 'project') return;
    await assetsApi.createFolder(newFolderName.trim(), view.projectId === 'none' ? null : view.projectId, view.folderId);
    setNewFolderName(''); setShowNewFolder(false); load();
  };

  const handleRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    await assetsApi.renameFolder(renaming.id, renaming.name.trim());
    setRenaming(null); load();
  };

  const handleDeleteFolder = async (id: number) => {
    if (!confirm('Delete this folder and all its contents?')) return;
    await assetsApi.deleteFolder(id); setCtxMenu(null); load();
  };

  const handleDeleteFile = async (id: number) => {
    if (!confirm('Delete this file?')) return;
    await assetsApi.delete(id); setCtxMenu(null); load();
  };

  const handleDownload = async (id: number, name: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(assetsApi.downloadUrl(id), { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const isImage = (type: string | null) => !!type?.startsWith('image/');

  const openPreview = async (file: FileRow) => {
    if (!isImage(file.file_type)) { handleDownload(file.id, file.name); return; }
    const token = localStorage.getItem('token');
    const res = await fetch(assetsApi.downloadUrl(file.id), { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setPreview({ url, name: file.name });
  };

  const onCtx = (e: React.MouseEvent, type: 'folder' | 'file', id: number, name: string) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 160), y: e.clientY, type, id, name });
  };

  return (
    <Layout>
      <div
        className="page-wrap"
        style={{ userSelect: 'none' }}
        onDragOver={e => { if (view.kind === 'project') { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 className="page-title" style={{ marginBottom: 6 }}>Assets</h2>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={() => setView({ kind: 'root' })} style={crumbBtn(view.kind === 'root')}>
                <Home size={13} /> Home
              </button>
              {view.kind === 'project' && (
                <>
                  <ChevronRight size={12} color="var(--ink-muted)" />
                  <button onClick={() => navBreadcrumb(-1)} style={crumbBtn(!view.folderId)}>
                    {view.projectName}
                  </button>
                  {view.breadcrumb.map((b, i) => (
                    <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ChevronRight size={12} color="var(--ink-muted)" />
                      <button onClick={() => navBreadcrumb(i)} style={crumbBtn(i === view.breadcrumb.length - 1)}>{b.name}</button>
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>

          {view.kind === 'project' && (
            <div style={{ display: 'flex', gap: 8 }}>
              {isAdmin && (
                <button className="btn-secondary" onClick={() => { setShowNewFolder(true); setNewFolderName(''); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <FolderPlus size={14} /> New Folder
                </button>
              )}
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => handleUpload(e.target.files)} />
              <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}
        </div>

        {/* Drag overlay */}
        {dragOver && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(59,130,246,0.15)',
            border: '3px dashed #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 600, color: '#3b82f6', pointerEvents: 'none',
          }}>
            Drop files here to upload
          </div>
        )}

        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>Loading…</div>
        ) : (
          <>
            {/* New folder input */}
            {showNewFolder && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: 'white', borderRadius: 8, border: '1px solid var(--border)' }}>
                <FolderIcon size={28} />
                <input
                  autoFocus
                  className="form-input"
                  style={{ flex: 1, maxWidth: 260 }}
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
                />
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={handleCreateFolder}>Create</button>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onClick={() => setShowNewFolder(false)}><X size={14} /></button>
              </div>
            )}

            {/* ROOT VIEW — project folders grid */}
            {view.kind === 'root' && (
              <div className="wa-explorer-grid">
                {projects.map(p => (
                  <div key={p.id} className="wa-explorer-item" onDoubleClick={() => openProject(p.id, p.name)}>
                    <FolderIcon size={72} />
                    <span className="wa-explorer-label">{p.name}</span>
                    <span className="wa-explorer-meta">{p.file_count} file{Number(p.file_count) !== 1 ? 's' : ''}</span>
                  </div>
                ))}
                {noProjectCount > 0 && (
                  <div className="wa-explorer-item" onDoubleClick={() => openProject('none', 'No Project')}>
                    <FolderIcon size={72} />
                    <span className="wa-explorer-label">No Project</span>
                    <span className="wa-explorer-meta">{noProjectCount} file{noProjectCount !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {projects.length === 0 && noProjectCount === 0 && (
                  <div style={{ color: 'var(--ink-muted)', fontSize: 14, padding: 40 }}>No projects yet.</div>
                )}
              </div>
            )}

            {/* FOLDER/FILE VIEW */}
            {view.kind === 'project' && (
              <div className="wa-explorer-grid">
                {/* Subfolders */}
                {folders.map(f => (
                  <div
                    key={`f-${f.id}`}
                    className="wa-explorer-item"
                    onDoubleClick={() => openFolder(f)}
                    onContextMenu={e => onCtx(e, 'folder', f.id, f.name)}
                  >
                    <FolderIcon size={72} />
                    {renaming?.id === f.id ? (
                      <input
                        autoFocus
                        className="wa-rename-input"
                        value={renaming.name}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                        onBlur={handleRename}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(null); }}
                      />
                    ) : (
                      <span className="wa-explorer-label">{f.name}</span>
                    )}
                  </div>
                ))}

                {/* Files */}
                {files.map(file => (
                  <div
                    key={`file-${file.id}`}
                    className="wa-explorer-item"
                    onContextMenu={e => onCtx(e, 'file', file.id, file.name)}
                    onDoubleClick={() => openPreview(file)}
                  >
                    {isImage(file.file_type) ? (
                      <ImageThumb id={file.id} name={file.name} />
                    ) : (
                      <FileTypeIcon type={file.file_type} />
                    )}
                    <span className="wa-explorer-label">{file.name}</span>
                    <span className="wa-explorer-meta">{fileSize(file.file_size)} · {format(new Date(file.created_at), 'MMM d')}</span>
                  </div>
                ))}

                {folders.length === 0 && files.length === 0 && !showNewFolder && (
                  <div style={{ color: 'var(--ink-muted)', fontSize: 14, padding: 40, gridColumn: '1/-1' }}>
                    Empty folder — drag files here or click Upload.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Image preview lightbox */}
        {preview && (
          <div
            onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'absolute', top: 20, right: 24 }}>
              <button
                onClick={async e => { e.stopPropagation(); handleDownload(files.find(f => f.name === preview.name)?.id ?? 0, preview.name); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> Download
              </button>
              <button
                onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                <X size={16} />
              </button>
            </div>
            <img
              src={preview.url}
              alt={preview.name}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', objectFit: 'contain' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{preview.name}</span>
          </div>
        )}

        {/* Context menu */}
        {ctxMenu && (
          <div
            style={{
              position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999,
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              minWidth: 150, padding: '4px 0', fontSize: 13,
            }}
            onClick={e => e.stopPropagation()}
          >
            {ctxMenu.type === 'folder' && isAdmin && (
              <button className="ctx-item" onClick={() => { setRenaming({ id: ctxMenu.id, name: ctxMenu.name }); setCtxMenu(null); }}>
                <Edit2 size={13} /> Rename
              </button>
            )}
            {ctxMenu.type === 'file' && (() => {
              const f = files.find(fl => fl.id === ctxMenu.id);
              return (<>
                {f && isImage(f.file_type) && (
                  <button className="ctx-item" onClick={() => { openPreview(f); setCtxMenu(null); }}>
                    <span style={{ fontSize: 13 }}>🔍</span> Preview
                  </button>
                )}
                <button className="ctx-item" onClick={() => { handleDownload(ctxMenu.id, ctxMenu.name); setCtxMenu(null); }}>
                  <Download size={13} /> Download
                </button>
              </>);
            })()}
            {isAdmin && (
              <button className="ctx-item danger" onClick={() =>
                ctxMenu.type === 'folder' ? handleDeleteFolder(ctxMenu.id) : handleDeleteFile(ctxMenu.id)
              }>
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function crumbBtn(active: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
    borderRadius: 4, fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? 'var(--ink)' : 'var(--ink-muted)',
    display: 'flex', alignItems: 'center', gap: 4,
  };
}
