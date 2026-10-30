import { useState, forwardRef } from 'react';

export type Person = { id: number; name: string; avatar_color?: string; role?: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<any>) => void;
  people: Person[];
  multiline?: boolean;
  rows?: number;
} & Omit<React.InputHTMLAttributes<any>, 'value' | 'onChange' | 'onKeyDown'>;

// Text box that suggests people when you type "@" and inserts "@Full Name "
const MentionField = forwardRef<any, Props>(function MentionField({ value, onChange, onKeyDown, people, multiline, ...rest }, ref) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const matches = query == null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const pick = (p: Person, el: HTMLInputElement | HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const handleKey = (e: React.KeyboardEvent<any>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active], e.currentTarget); return; }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    }
    onKeyDown?.(e);
  };

  const common = {
    ...rest,
    ref,
    value,
    onChange: (e: React.ChangeEvent<any>) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart ?? e.target.value.length); },
    onKeyDown: handleKey,
    onBlur: (e: React.FocusEvent<any>) => { setTimeout(() => setQuery(null), 150); rest.onBlur?.(e); },
    'aria-autocomplete': 'list' as const,
    'aria-expanded': matches.length > 0,
  };

  return (
    <div style={{ position: 'relative' }}>
      {multiline ? <textarea {...common} /> : <input {...common} />}
      {matches.length > 0 && (
        <div role="listbox" aria-label="Mention someone" style={{ position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 60, minWidth: 220, maxHeight: 240, overflowY: 'auto', background: 'var(--surface, #fff)', border: '1px solid var(--sand-border, #e5e7eb)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.12)', padding: 4 }}>
          {matches.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); const el = (e.currentTarget.closest('div[role=listbox]')?.previousElementSibling) as any; pick(p, el); }}
              onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderRadius: 7, cursor: 'pointer', background: i === active ? 'var(--bg-sand, #f1f5f9)' : 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 13 }}>
              <span aria-hidden style={{ width: 20, height: 20, borderRadius: 99, background: p.avatar_color || '#94a3b8', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{p.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              {p.role && <span style={{ fontSize: 10.5, color: 'var(--ink-muted)', textTransform: 'capitalize' }}>{p.role}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MentionField;

// Highlights "@Full Name" for people in the list
export function renderMentions(text: string, people: Person[]) {
  const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(@(?:${names.map(esc).join('|')}))`, 'gi');
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? <strong key={i} style={{ color: 'var(--blue, #2563eb)', fontWeight: 700 }}>{part}</strong> : part);
}
