import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
  pageSizeOptions?: number[];
}

export default function Pagination({
  page, totalPages, total, pageSize,
  onPage, onPageSize,
  pageSizeOptions = [10, 20, 50],
}: PaginationProps) {
  if (totalPages <= 1 && total <= pageSizeOptions[0]) return null;

  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  const pages: (number | '…')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 4px', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
        {start}–{end} of {total}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          style={btnStyle(page === 1)}
        >
          <ChevronLeft size={14} />
        </button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} style={{ padding: '0 4px', fontSize: 12, color: 'var(--ink-muted)' }}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              style={btnStyle(false, p === page)}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          style={btnStyle(page === totalPages)}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {onPageSize && (
        <select
          value={pageSize}
          onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1.5px solid var(--sand-border)', background: 'var(--bg-white)', color: 'var(--ink)', cursor: 'pointer' }}
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </select>
      )}
    </div>
  );
}

function btnStyle(disabled: boolean, active = false): React.CSSProperties {
  return {
    minWidth: 30, height: 30,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
    border: active ? 'none' : '1.5px solid var(--sand-border)',
    background: active ? 'var(--ink)' : disabled ? 'transparent' : 'var(--bg-white)',
    color: active ? '#fff' : disabled ? 'var(--sand-border)' : 'var(--ink)',
    fontSize: 12, fontWeight: active ? 700 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: '0 4px',
    transition: 'all 0.14s',
  };
}
