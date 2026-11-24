// In-page notices and confirmation boxes, instead of the browser's alert/confirm/prompt pop-ups.
// notify("Saved") shows a short notice; await ask({...}) opens a box and returns the typed text ('' when there is no
// input), or null when cancelled. <DialogHost /> is mounted once on the page that uses them.
import { useEffect, useState } from 'react';

type Ask = { title: string; text?: string; confirm?: string; danger?: boolean; input?: { placeholder?: string; required?: boolean; match?: string; multiline?: boolean } };
type Open = Ask & { resolve: (v: string | null) => void };
let pushNotice: ((n: { text: string; tone: 'good' | 'bad' | 'info' }) => void) | null = null;
let openAsk: ((a: Open) => void) | null = null;

export const notify = (text: string, tone: 'good' | 'bad' | 'info' = 'info') => pushNotice?.({ text, tone });
export const ask = (a: Ask) => new Promise<string | null>((resolve) => (openAsk ? openAsk({ ...a, resolve }) : resolve(null)));

export function DialogHost() {
  const [notices, setNotices] = useState<{ id: number; text: string; tone: string }[]>([]);
  const [box, setBox] = useState<Open | null>(null); const [val, setVal] = useState('');
  useEffect(() => {
    pushNotice = (n) => { const id = Date.now() + Math.random(); setNotices((x) => [...x, { id, ...n }]); setTimeout(() => setNotices((x) => x.filter((m) => m.id !== id)), n.tone === 'bad' ? 6000 : 3500); };
    openAsk = (a) => { setVal(''); setBox(a); };
    return () => { pushNotice = null; openAsk = null; };
  }, []);
  const close = (v: string | null) => { box?.resolve(v); setBox(null); };
  const ok = !box?.input || (box.input.match ? val.trim() === box.input.match : !box.input.required || !!val.trim());
  return (<>
    <div className="dlg-notices" aria-live="polite">{notices.map((n) => <div key={n.id} className={`dlg-notice dlg-notice--${n.tone}`}>{n.text}</div>)}</div>
    {box && (
      <div className="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
        <form className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onSubmit={(e) => { e.preventDefault(); if (ok) close(box.input ? val.trim() : ''); }} onKeyDown={(e) => { if (e.key === 'Escape') close(null); }}>
          <h3 id="dlg-title">{box.title}</h3>
          {box.text && <p>{box.text}</p>}
          {box.input && (box.input.multiline
            ? <textarea className="form-input" rows={3} autoFocus value={val} placeholder={box.input.placeholder} onChange={(e) => setVal(e.target.value)} />
            : <input className="form-input" autoFocus value={val} placeholder={box.input.placeholder} onChange={(e) => setVal(e.target.value)} />)}
          <div className="dlg-actions">
            <button type="button" className="btn-secondary" onClick={() => close(null)}>Cancel</button>
            <button type="submit" className={box.danger ? 'rec-btn-danger' : 'btn-primary'} disabled={!ok} autoFocus={!box.input}>{box.confirm ?? 'OK'}</button>
          </div>
        </form>
      </div>
    )}
  </>);
}
