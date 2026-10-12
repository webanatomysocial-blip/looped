// "Added by <name> · <stage>" line shown under an attachment
export default function AttachmentMeta({ d }: { d: { uploader_name?: string | null; stage_name?: string | null; [k: string]: any } }) {
  if (!d?.uploader_name && !d?.stage_name) return null;
  return (
    <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {d.uploader_name && <>Added by <strong style={{ fontWeight: 600 }}>{d.uploader_name}</strong></>}
      {d.stage_name && (
        <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#4f46e5', fontWeight: 600 }}>
          {d.stage_name}
        </span>
      )}
    </div>
  );
}
