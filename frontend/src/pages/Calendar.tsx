import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TaskViewDrawer from '../components/UI/TaskViewDrawer';
import Layout from '../components/Layout/Layout';
import { calendarApi, usersApi, projectsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { ChevronLeft, ChevronRight, Calendar, Clock, Repeat, CheckCircle, Zap, TrendingUp, Minus, AlertTriangle, FolderOpen } from 'lucide-react';
import '../css/pages/Calendar.css';
import { fmtDate as fmtDDMMYYYY } from '../utils/date';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_CAP = 7; // working hours per day

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; border: string; icon: any; label: string }> = {
  urgent: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: Zap,          label: 'Urgent' },
  high:   { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', icon: TrendingUp,   label: 'High'   },
  medium: { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: Minus,        label: 'Medium' },
  low:    { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb', icon: AlertTriangle, label: 'Low'   },
};

function toYM(y: number, m: number) { return `${y}-${String(m).padStart(2,'0')}`; }
function fmtDate(d: string) { return fmtDDMMYYYY(d); }
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}
function dateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtSec(s: number) { const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtHrs(h: number) { const wh = Math.floor(h); const m = Math.round((h - wh) * 60); return m > 0 ? (wh > 0 ? `${wh}h ${m}min` : `${m}min`) : `${wh}h`; }

function describeRecurrence(rt: any) {
  if (rt.recurrence_type === 'daily') return 'Every day';
  if (rt.recurrence_type === 'monthly') return `Monthly on day ${rt.day_of_month || 1}`;
  const days: number[] = Array.isArray(rt.recurrence_days) ? rt.recurrence_days : (rt.recurrence_days ? JSON.parse(rt.recurrence_days) : []);
  if (!days.length) return 'Weekly';
  return 'Every ' + days.map(d => WEEKDAYS[d]).join(', ');
}

// ─── Capacity bar ────────────────────────────────────────────────────────────
function CapacityBar({ tasks, showOver = true }: { tasks: any[]; showOver?: boolean }) {
  const personalTasks = tasks.filter(t => !t.is_placeholder && !t.is_overview);
  const used = personalTasks.reduce((s, t) => s + (Number(t.slot_hours ?? t.estimated_hours) || 0), 0);
  const pct = Math.min(used / DAY_CAP, 1);
  const over = used > DAY_CAP;
  const color = over && showOver ? '#dc2626' : used >= DAY_CAP * 0.85 ? '#ea580c' : '#22c55e';
  return (
    <div style={{ marginBottom: 8, padding: '0 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: over ? '#dc2626' : 'var(--ink-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {fmtHrs(used)} / {DAY_CAP}h
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, color: over && showOver ? '#dc2626' : 'var(--ink-muted)' }}>
          {over ? (showOver ? `Over by ${fmtHrs(used - DAY_CAP)}` : '') : used > 0 ? `${fmtHrs(DAY_CAP - used)} free` : ''}
        </span>
      </div>
      <div style={{ height: 4, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ─── Task block ──────────────────────────────────────────────────────────────
function TaskBlock({ task, onClick }: { task: any; onClick: () => void }) {
  const p = task.priority || 'medium';
  const cfg = PRIORITY_CONFIG[p] || PRIORITY_CONFIG.medium;
  const Icon = cfg.icon;
  const isDone = task.status === 'completed' || task.status === 'done';
  const isRecurring = task.event_type === 'recurring';
  const hrs = task.user_est_hours != null ? Number(task.user_est_hours) : (Number(task.estimated_hours) || 0);
  const slotHrs = task.slot_hours != null ? Number(task.slot_hours) : hrs;
  const isSplit = slotHrs < hrs && slotHrs > 0.01;
  const tracked = Number(task.tracked_seconds) || 0;

  const isPlaceholder = !!task.is_placeholder;

  return (
    <div
      onClick={onClick}
      style={{
        background: isDone ? '#f0fdf4' : isRecurring ? 'rgba(99,102,241,0.06)' : cfg.bg,
        border: isPlaceholder ? `1.5px dashed ${cfg.border}` : `1.5px solid ${isDone ? '#bbf7d0' : isRecurring ? '#c7d2fe' : cfg.border}`,
        borderLeft: `3px ${isPlaceholder ? 'dashed' : 'solid'} ${isDone ? '#22c55e' : isRecurring ? '#818cf8' : cfg.color}`,
        opacity: isPlaceholder ? 0.65 : 1,
        borderRadius: 8,
        padding: '7px 9px',
        cursor: 'pointer',
        transition: 'transform 0.1s, box-shadow 0.1s',
        position: 'relative',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 10px rgba(0,0,0,0.08)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4 }}>
        {isDone
          ? <CheckCircle size={11} color="#22c55e" style={{ flexShrink: 0, marginTop: 1 }} />
          : isRecurring
          ? <Repeat size={11} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
          : <Icon size={11} color={cfg.color} style={{ flexShrink: 0, marginTop: 1 }} />
        }
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: isDone ? '#15803d' : 'var(--ink)',
          lineHeight: 1.3,
          textDecoration: isDone ? 'line-through' : 'none',
          flex: 1,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {task.title}
        </span>
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {!isDone && !isRecurring && (
          <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 99, padding: '1px 6px', letterSpacing: '0.03em' }}>
            {cfg.label}
          </span>
        )}
        {task.project_name && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--ink-muted)', fontWeight: 600 }}>
            <FolderOpen size={9} />
            {task.project_name}
          </span>
        )}
        {slotHrs > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, color: isSplit ? '#ea580c' : 'var(--ink-muted)' }}>
            <Clock size={9} />
            {isSplit ? `${fmtHrs(slotHrs)} today / ${fmtHrs(hrs)} total` : fmtHrs(slotHrs > 0 ? slotHrs : hrs)}
          </span>
        )}
        {task.due_date && !isRecurring && (
          <span style={{ fontSize: 9, color: 'var(--ink-muted)', fontWeight: 600 }}>Due {fmtDate(task.due_date)}</span>
        )}
        {tracked > 0 && (
          <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 700 }}>· {fmtSec(tracked)}</span>
        )}
        {task.is_overview && task.assigned_to_name && (
          <span style={{ fontSize: 9, color: '#818cf8', fontWeight: 700 }}>· {task.assigned_to_name}</span>
        )}
        {task.is_overview && !task.assigned_to_name && task.assigned_name && (
          <span style={{ fontSize: 9, color: 'var(--ink-muted)', fontWeight: 700 }}>· {task.assigned_name}</span>
        )}
      </div>
    </div>
  );
}

// ─── Scheduling feedback ─────────────────────────────────────────────────────
type Health = { state: 'ok' | 'risk' | 'impossible' | 'overdue'; required: number; available: number; buffer: number; what: string; why: string; fix: string };
type Verdict = { tone: 'ok' | 'warn' | 'bad'; what: string; why: string; fix: string };
type DeadlineState = { state: Health['state']; buffer: number };
type MovePreview = { tone: 'ok' | 'warn' | 'bad'; allowed: boolean; headline: string; moved?: { label: string; from: string; to: string }; issues: { tone: 'warn' | 'bad'; what: string; why: string; fix: string }[]; changes: { label: string; from: string; to: string }[]; buffer: number | null; deadlineBefore?: DeadlineState; deadlineAfter?: DeadlineState };
const DAY_HINT = {
  ok: { label: '✓ Safe to move', tip: 'Nothing else changes and the deadline is still met.' },
  warn: { label: '⚠ Will affect other work', tip: 'This move is possible, but other scheduled work or later stages will change. You review the changes before anything moves.' },
  bad: { label: '✕ Deadline or capacity conflict', tip: "Moving here would miss a deadline or overload someone. You can still override it after reading why." },
};
function deadlineText(d?: DeadlineState) {
  if (!d) return '';
  if (d.state === 'overdue') return '🔴 Already overdue';
  if (d.buffer < 0) return `🔴 Missed by ${fmtHrs(-d.buffer)}`;
  return `${d.state === 'risk' ? '🟡' : '🟢'} ${fmtHrs(d.buffer)} buffer`;
}
type DragInfo = { moved?: boolean; key: string; hrs: number; offsetY: number; colEl: HTMLElement; day: string; fromH: number; title: string; slotId?: number; recurringTaskId?: number; taskId?: number; stage?: number | null };
const toneKey = (t?: string) => (t === 'bad' ? 'bad' : t === 'warn' ? 'risk' : 'ok') as keyof typeof TONE;
const TONE = {
  ok:   { color: '#16a34a', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.35)' },
  risk: { color: '#d97706', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.4)' },
  bad:  { color: '#dc2626', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.35)' },
};
const WORK_START = 9, WORK_END = 18;
function fmtClock(h: number) { const hr = Math.floor(h), m = Math.round((h - hr) * 60); return `${hr % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${hr < 12 ? 'am' : 'pm'}`; }
function canDragBase(task: any, isPlaceholder: boolean, key: string | null) { return !isPlaceholder && key != null && !task.is_overview; }

// What happens if the dragged block is dropped where it is now
function dropVerdict(o: { title: string; startH: number; endH: number; day: string; today: string; nowH: number; others: { task: any; startH: number; endH: number }[] }): Verdict {
  if (o.day === o.today && o.startH < o.nowH) return { tone: 'bad', what: 'That time has already passed', why: `It's ${fmtClock(Math.floor(o.nowH * 2) / 2)} now, so work can't be planned earlier today.`, fix: 'Drop it later today.' };
  const clash = o.others.filter(b => b.startH < o.endH && b.endH > o.startH);
  if (clash.length) return { tone: 'warn', what: `Overlaps ${clash.map(b => `"${b.task.title}"`).join(', ')}`, why: `You'd be booked for two things at once between ${fmtClock(Math.max(o.startH, Math.min(...clash.map(b => b.startH))))} and ${fmtClock(Math.min(o.endH, Math.max(...clash.map(b => b.endH))))}.`, fix: 'Drop it in a free gap, or move the other block first. You can still drop it here.' };
  if (o.startH < WORK_START || o.endH > WORK_END) return { tone: 'warn', what: 'Outside working hours', why: `Working hours are ${fmtClock(WORK_START)}–${fmtClock(WORK_END)}; this would run ${fmtClock(o.startH)}–${fmtClock(o.endH)}.`, fix: 'Move it inside working hours unless you plan to work late.' };
  return { tone: 'ok', what: `Free time — ${fmtClock(o.startH)}–${fmtClock(o.endH)}`, why: 'Nothing else is booked then. The due date is not affected.', fix: '' };
}

// ─── Weekly view ─────────────────────────────────────────────────────────────
const GRID_START_H = 0;
const GRID_END_H   = 24;
const ROW_PX       = 60;

function WeekView({ monday, onTaskClick, refreshKey }: { monday: Date; onTaskClick: (task: any) => void; refreshKey?: number }) {
  const { user } = useAuth();
  const isOverview = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState<{ days: string[]; byDay: Record<string, any[]>; health?: Record<string, Health> } | null>(null);
  const [showHealth, setShowHealth] = useState<null | 'bad' | 'risk' | 'ok'>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad'; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verdictRef = useRef<Verdict | null>(null);
  // Moving to another day: what each day would cause (fetched when the drag starts), and the move awaiting confirmation
  const [options, setOptions] = useState<Record<string, MovePreview> | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const optionsRef = useRef<Record<string, MovePreview> | null>(null);
  const [confirm, setConfirm] = useState<{ taskId: number; stage: number | null; title: string; day: string; preview: MovePreview } | null>(null);
  const [reload, setReload] = useState(0);
  const loadedWeek = useRef<string | null>(null);
  const crossRef = useRef<(d: DragInfo, day: string) => void>(() => {});
  const lastDragEnd = useRef(0); // releasing a drag also fires a click; don't open the task drawer for it
  const flash = (t: NonNullable<typeof toast>) => { setToast(t); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 8000); };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowPct, setNowPct] = useState(() => {
    const n = new Date(); return ((n.getHours() + n.getMinutes() / 60 - GRID_START_H) / (GRID_END_H - GRID_START_H)) * 100;
  });
  // Map drag key → pinned start hour (local overrides after drag); key = `slot_${slotId}` or `rec_${taskId}`
  const [pinned, setPinned] = useState<Record<string, number>>({});
  // Active drag state
  const dragRef = useRef<DragInfo | null>(null);
  const [dragPos, setDragPos] = useState<{ key: string; startH: number; day: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const today = dateStr(new Date());

  useEffect(() => {
    const tick = () => { const n = new Date(); setNowPct(((n.getHours() + n.getMinutes() / 60 - GRID_START_H) / (GRID_END_H - GRID_START_H)) * 100); };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const week = dateStr(monday);
    const fresh = loadedWeek.current !== week; // reloading after a move keeps the grid on screen
    loadedWeek.current = week;
    if (fresh) setLoading(true);
    setError(null);
    calendarApi.getWeek(week)
      .then(r => { setPinned({}); setData(r.data); if (fresh) setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = (9 - GRID_START_H) * ROW_PX; }, 50); })
      .catch(e => setError(e?.response?.data?.error || 'Failed to load week'))
      .finally(() => setLoading(false));
  }, [dateStr(monday), refreshKey, reload]);

  useEffect(() => {
    if (!confirm) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirm(null); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [confirm]);

  async function commitMove(taskId: number, stage: number | null, day: string, title: string) {
    setConfirm(null);
    try {
      const r = await calendarApi.moveWork(taskId, stage, day);
      setReload(x => x + 1);
      flash({ text: `✓ Schedule updated — "${title}" now starts ${fmtDate(day)}.`, tone: 'ok', undo: async () => {
        setToast(null);
        try { await calendarApi.moveWork(taskId, stage, r.data.previous, r.data.previousTimes); setReload(x => x + 1); flash({ text: 'Move undone — everything is back where it was.', tone: 'ok' }); }
        catch (e: any) { flash({ text: `Couldn't undo. ${e?.response?.data?.error || ''}`, tone: 'bad' }); }
      } });
    } catch (e: any) { flash({ text: `Not moved. ${e?.response?.data?.error || "The server didn't accept this move."}`, tone: 'bad' }); }
  }
  crossRef.current = (d, day) => {
    if (day < today) { flash({ text: "Not moved. That day has passed — work can only be planned for today or later.", tone: 'bad' }); return; }
    const p = optionsRef.current?.[day];
    if (!p) { flash({ text: optionsError ? `Not moved. ${optionsError}` : 'Still checking that day — try the drop again in a moment.', tone: 'bad' }); return; }
    if (!p.allowed) { flash({ text: `Not moved. ${p.headline}. ${p.issues[0]?.fix ?? ''}`, tone: 'bad' }); return; }
    if (p.tone === 'ok') commitMove(d.taskId!, d.stage ?? null, day, d.title);
    else setConfirm({ taskId: d.taskId!, stage: d.stage ?? null, title: d.title, day, preview: p });
  };

  // Pointer drag handlers (attached to document when drag active)
  useEffect(() => {
    const snap = (h: number) => Math.round(h * 2) / 2; // 30-min snap

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let day = d.day, colEl = d.colEl;
      if (d.taskId != null) for (const [k, el] of Object.entries(colRefs.current)) {
        const r = el?.getBoundingClientRect();
        if (el && r && e.clientX >= r.left && e.clientX < r.right) { day = k; colEl = el; break; }
      }
      const rect = colEl.getBoundingClientRect();
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      const relY = e.clientY - rect.top + scrollTop - d.offsetY;
      const raw = GRID_START_H + relY / ROW_PX;
      const clamped = Math.max(GRID_START_H, Math.min(GRID_END_H - d.hrs, raw));
      d.moved = true;
      setDragPos({ key: d.key, startH: snap(clamped), day });
    };

    const onUp = async () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (d.moved) lastDragEnd.current = Date.now();
      const v = verdictRef.current;
      verdictRef.current = null;
      setDragPos(prev => {
        if (prev && prev.day !== d.day) { setTimeout(() => crossRef.current(d, prev.day)); return null; }
        if (!prev || prev.startH === d.fromH) return null;
        if (v?.tone === 'bad') { flash({ text: `Not moved. ${v.what}. ${v.fix}`, tone: 'bad' }); return null; }
        const save = (h: number) => {
          setPinned(p => ({ ...p, [d.key]: h }));
          const req = d.slotId != null ? calendarApi.updateSlotTime(d.slotId, h) : d.recurringTaskId != null ? calendarApi.updateRecurringTime(d.recurringTaskId, d.day, h) : null;
          return req?.catch((err: any) => {
            setPinned(p => ({ ...p, [d.key]: d.fromH }));
            flash({ text: `Not moved. ${err?.response?.data?.error || "The server didn't accept this move."}`, tone: 'bad' });
            throw err;
          });
        };
        const h = prev.startH;
        save(h)?.then(() => flash({ text: `Moved "${d.title}" to ${fmtClock(h)}${v?.tone === 'warn' ? ` — ${v.what.toLowerCase()}` : ''}`, tone: 'ok', undo: () => { setToast(null); save(d.fromH)?.catch(() => {}); } })).catch(() => {});
        return null;
      });
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>Loading week…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>;
  if (!data) return null;
  const crossDrag = dragPos != null && dragRef.current?.taskId != null;
  const crossAway = crossDrag && dragPos!.day !== dragRef.current!.day;

  const overDays = isOverview ? [] : data.days
    .map(day => ({ day, used: (data.byDay[day] || []).filter((t: any) => !t.is_placeholder && !t.is_overview).reduce((s: number, t: any) => s + (Number(t.slot_hours ?? t.estimated_hours) || 0), 0) }))
    .filter(x => x.used > DAY_CAP);
  const titles: Record<string, string> = {};
  for (const t of Object.values(data.byDay).flat() as any[]) titles[t.id] = t.title;
  const healthRows = Object.entries(data.health || {}).map(([id, h]) => ({ id, title: titles[id] || 'Ticket', h }));
  const groups = {
    bad: healthRows.filter(r => r.h.state === 'impossible' || r.h.state === 'overdue'),
    risk: healthRows.filter(r => r.h.state === 'risk'),
    ok: healthRows.filter(r => r.h.state === 'ok'),
  };
  const shown = showHealth ? groups[showHealth] : [];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {(healthRows.length > 0 || overDays.length > 0) && (
        <div style={{ border: '1px solid var(--sand-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, background: 'var(--bg-white)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', marginRight: 4 }}>Deadlines this week</span>
            {(['bad', 'risk', 'ok'] as const).map(k => groups[k].length > 0 && (
              <button key={k} onClick={() => setShowHealth(showHealth === k ? null : k)}
                style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, cursor: 'pointer', border: `1px solid ${TONE[k].border}`, background: showHealth === k ? TONE[k].color : TONE[k].bg, color: showHealth === k ? '#fff' : TONE[k].color }}>
                {groups[k].length} {k === 'bad' ? "won't make it" : k === 'risk' ? 'no room for delay' : 'on track'}
              </button>
            ))}
            {overDays.map(x => (
              <span key={x.day} style={{ fontSize: 11, fontWeight: 700, color: TONE.bad.color }}>
                · {fmtDate(x.day)} over capacity by {fmtHrs(x.used - DAY_CAP)}
              </span>
            ))}
          </div>
          {shown.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {shown.map(r => (
                <div key={r.id} style={{ fontSize: 12, lineHeight: 1.45, borderLeft: `3px solid ${TONE[showHealth!].color}`, paddingLeft: 10 }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.title} — {r.h.what}</div>
                  <div style={{ color: 'var(--ink-muted)' }}>{r.h.why}{r.h.fix && <> <b style={{ color: 'var(--ink)' }}>What you can do:</b> {r.h.fix}</>}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Time grid — Google Calendar style */}
      {(() => {
        const fmtHour = (h: number) => { const hr = Math.floor(h); const min = Math.round((h - hr) * 60); const disp = hr % 12 || 12; const ampm = hr < 12 ? 'am' : 'pm'; return min > 0 ? `${disp}:${String(min).padStart(2,'0')}${ampm}` : `${disp}${ampm}`; };
        const GRID_START = GRID_START_H;
        const GRID_END   = GRID_END_H;
        const ROW_H      = ROW_PX;
        const TIME_COL_W = 52;
        const hours = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);

        // Compute start times. Pinned tasks (custom_start_hour / local overrides) use their pinned time;
        // unpinned tasks stack from 9am in priority order.
        // Assign side-by-side columns for overlapping blocks
        function assignColumns(blocks: { task: any; startH: number; endH: number }[]) {
          const cols: number[] = new Array(blocks.length).fill(0);
          const totals: number[] = new Array(blocks.length).fill(1);
          // For each block, find all blocks that overlap with it
          for (let i = 0; i < blocks.length; i++) {
            // collect overlapping group
            const group: number[] = [i];
            for (let j = 0; j < blocks.length; j++) {
              if (i === j) continue;
              if (blocks[j].startH < blocks[i].endH && blocks[j].endH > blocks[i].startH) group.push(j);
            }
            if (group.length === 1) continue;
            // assign cols greedily within group
            const used: boolean[] = [];
            for (const idx of group.sort((a,b) => a - b)) {
              // find first free col not used by overlapping already-assigned blocks
              const takenCols = group.filter(k => k < idx).map(k => cols[k]);
              let c = 0; while (takenCols.includes(c)) c++;
              cols[idx] = c;
              used[c] = true;
            }
            const maxCol = Math.max(...group.map(k => cols[k])) + 1;
            for (const idx of group) totals[idx] = maxCol;
          }
          return blocks.map((b, i) => ({ ...b, col: cols[i], totalCols: totals[i] }));
        }

        const earliestOpen: Record<string, string> = {};
        const blockCount: Record<string, number> = {};
        const nowH = new Date().getHours() + new Date().getMinutes() / 60;
        for (const day of data.days) {
          if (day < today) continue;
          for (const t of (data.byDay[day] || []) as any[]) {
            if (t.slot_id == null) continue;
            const k = `${t.id}_${t.scheduled_stage ?? ''}`;
            if (!earliestOpen[k] || day < earliestOpen[k]) earliestOpen[k] = day;
            blockCount[k] = (blockCount[k] || 0) + 1;
          }
        }

        const dayBlocks: Record<string, { task: any; startH: number; endH: number }[]> = {};
        for (const day of data.days) {
          let cursor = 9;
          dayBlocks[day] = [];
          const pinnedTasks: { task: any; startH: number; endH: number }[] = [];
          const freeTasks: any[] = [];
          for (const task of (data.byDay[day] || [])) {
            if (task.is_overview) { freeTasks.push(task); continue; } // overview tasks stack in grid too
            const slotId = task.slot_id;
            const dragKey = slotId != null ? `slot_${slotId}` : task.event_type === 'recurring' ? `rec_${task.id}` : null;
            const pinnedH = dragKey != null ? (pinned[dragKey] ?? (task.custom_start_hour ?? null)) : null;
            if (pinnedH != null) {
              const hrs = Number(task.slot_hours ?? task.estimated_hours) || 1;
              pinnedTasks.push({ task, startH: pinnedH, endH: Math.min(pinnedH + hrs, GRID_END) });
            } else {
              freeTasks.push(task);
            }
          }
          // Stack free tasks after all pinned blocks (simple: from cursor, no interleaving)
          for (const task of freeTasks) {
            const hrs = Number(task.slot_hours ?? task.estimated_hours) || 1;
            const startH = cursor;
            const endH   = Math.min(startH + hrs, GRID_END);
            dayBlocks[day].push({ task, startH, endH });
            cursor = endH;
            if (cursor >= GRID_END) break;
          }
          dayBlocks[day] = [...pinnedTasks, ...dayBlocks[day]];
        }

        return (
          <div style={{ border: '1px solid var(--sand-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-white)' }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: `${TIME_COL_W}px repeat(5, 1fr)`, borderBottom: '1px solid var(--sand-border)' }}>
              <div style={{ background: 'var(--bg-sand)' }} />
              {data.days.map((day, i) => {
                const isToday = day === today;
                const d = new Date(day + 'T00:00:00');
                return (
                  <div key={day} style={{ background: isToday ? 'var(--ink)' : 'var(--bg-sand)', padding: '10px 0 8px', textAlign: 'center', borderLeft: '1px solid var(--sand-border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: isToday ? 'rgba(255,255,255,0.7)' : 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{DAY_LABELS[i]}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: isToday ? '#fff' : 'var(--ink)', lineHeight: 1.2 }}>{d.getDate()}</div>
                    <CapacityBar tasks={data.byDay[day] || []} showOver={!isOverview} />
                    {crossDrag && day !== dragRef.current!.day && (() => {
                      const o = options?.[day];
                      const hint = o?.allowed ? DAY_HINT[o.tone] : null;
                      const label = day < today ? '🔒 Day has passed' : optionsError ? '✕ Not movable' : !options ? 'Checking…' : !o ? '—' : !o.allowed ? `🔒 ${o.headline}` : hint!.label;
                      return <div title={hint?.tip ?? o?.issues[0]?.why} style={{ padding: '2px 6px', lineHeight: 1.3, fontSize: 10, fontWeight: 800, color: o ? TONE[toneKey(o.allowed ? o.tone : 'bad')].color : 'var(--ink-muted)', background: isToday ? 'rgba(255,255,255,0.9)' : undefined, borderRadius: 99, margin: '0 6px' }}>{label}</div>;
                    })()}
                  </div>
                );
              })}
            </div>

            {/* Scrollable time body */}
            <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: 520 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `${TIME_COL_W}px repeat(5, 1fr)`, position: 'relative' }}>
                {/* Time labels + hour grid lines */}
                <div style={{ position: 'relative' }}>
                  {hours.map(h => {
                    const isWork = h >= 9 && h < 18;
                    return (
                      <div key={h} style={{ height: ROW_H, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, borderTop: '1px solid var(--sand-border)', boxSizing: 'border-box', background: isWork ? 'rgba(37,99,235,0.03)' : 'transparent' }}>
                        <span style={{ fontSize: 10, color: isWork ? 'var(--ink)' : 'var(--ink-muted)', fontWeight: isWork ? 700 : 600, whiteSpace: 'nowrap' }}>{h % 12 || 12}{h < 12 ? 'am' : 'pm'}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Day columns */}
                {data.days.map((day) => {
                  const isToday = day === today;
                  const blocks = assignColumns(dayBlocks[day]);
                  const dayOpt = crossDrag && day !== dragRef.current!.day ? options?.[day] : undefined;
                  return (
                    <div key={day} ref={el => { colRefs.current[day] = el; }} style={{ position: 'relative', borderLeft: '1px solid var(--sand-border)', background: dayOpt ? TONE[toneKey(dayOpt.allowed ? dayOpt.tone : 'bad')].bg : isToday ? 'rgba(37,99,235,0.02)' : 'var(--bg-white)' }}>
                      {/* Hour grid lines */}
                      {hours.map(h => (
                        <div key={h} style={{ height: ROW_H, borderTop: '1px solid var(--sand-border)', boxSizing: 'border-box', background: h >= 9 && h < 18 ? 'rgba(37,99,235,0.03)' : 'transparent' }} />
                      ))}


                      {/* Task blocks */}
                      {blocks.map(({ task, startH: baseStartH, endH: baseEndH, col, totalCols }, j) => {
                        const colW = `calc((100% - 6px) / ${totalCols})`;
                        const colLeft = `calc(3px + ${col} * (100% - 6px) / ${totalCols})`;
                        const taskDragKey = task.slot_id != null ? `slot_${task.slot_id}` : task.event_type === 'recurring' ? `rec_${task.id}` : null;
                        const isDraggingAny = dragPos != null && taskDragKey != null && dragPos.key === taskDragKey;
                        const awayDrag = isDraggingAny && dragPos!.day !== day; // being dragged to another day: original stays put, dimmed
                        const isDragging = isDraggingAny && !awayDrag;
                        const startH = isDragging ? dragPos!.startH : baseStartH;
                        const hrs    = baseEndH - baseStartH;
                        const endH   = startH + hrs;
                        const top    = (startH - GRID_START) * ROW_H;
                        const height = Math.max(hrs * ROW_H - 3, 38);
                        const pc     = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                        const isPlaceholder = task.is_placeholder;
                        // Same rules as the server (slotDragBlock): past days, unfinished earlier stages, later blocks of a split task
                        const openKey = `${task.id}_${task.scheduled_stage ?? ''}`;
                        const blocker = task.blocking_stage_name || 'An earlier stage';
                        const lockReason = task.slot_id == null ? null
                          : day < today ? "This day has passed. Past work can't be moved — log time on the ticket instead."
                          : task.ticket_type_id && task.scheduled_stage != null && task.scheduled_stage > (task.xlr8_stage_idx ?? 0) ? `${blocker} isn't finished yet. ${task.stage_name || 'This stage'} can't be scheduled until ${task.blocking_stage_name || 'it'} is done — it unlocks automatically then.`
                          : (earliestOpen[openKey] ?? day) < day ? `This ticket has ${blockCount[openKey]} blocks this week. Move the first one (${fmtDate(earliestOpen[openKey])}) — the later blocks follow it.`
                          : null;
                        const canDrag = canDragBase(task, isPlaceholder, taskDragKey) && !lockReason;
                        const health: Health | undefined = data.health?.[task.id];
                        const hTone = health ? (health.state === 'ok' ? 'ok' : health.state === 'risk' ? 'risk' : 'bad') : null;
                        const verdict = isDragging ? dropVerdict({ title: task.title, startH, endH, day, today, nowH, others: blocks.filter(b => b.task !== task && !b.task.is_placeholder && !b.task.is_overview) }) : null;
                        if (isDragging) verdictRef.current = verdict;
                        const tip = [
                          task.title + (task.stage_name ? ` · ${task.stage_name}` : ''),
                          fmtHrs(hrs) + (task.due_date ? ` · due ${fmtDate(task.due_date)}` : ''),
                          health && `${health.what}: ${health.why}${health.fix ? ` ${health.fix}` : ''}`,
                          task.is_manual && '📌 You placed this by hand — the scheduler keeps it on this day.',
                          lockReason ? `🔒 ${lockReason}` : canDrag ? (task.event_type === 'recurring' ? 'Drag to change the time' : 'Drag up or down to change the time, or to another day to move it') : null,
                        ].filter(Boolean).join('\n');
                        return (
                          <div
                            key={task.id || j}
                            title={isDraggingAny ? undefined : tip}
                            onPointerDown={canDrag ? (e) => {
                              e.preventDefault();
                              const colEl = colRefs.current[day];
                              if (!colEl) return;
                              const rect = colEl.getBoundingClientRect();
                              const scrollTop = scrollRef.current?.scrollTop ?? 0;
                              const clickY = e.clientY - rect.top + scrollTop - top;
                              const crossDay = task.slot_id != null && task.event_type !== 'recurring';
                              dragRef.current = { key: taskDragKey!, hrs, offsetY: clickY, colEl, day, fromH: baseStartH, title: task.title, slotId: task.slot_id ?? undefined, recurringTaskId: task.event_type === 'recurring' ? task.recurring_task_id : undefined, taskId: crossDay ? task.id : undefined, stage: task.scheduled_stage ?? null };
                              setDragPos({ key: taskDragKey!, startH: baseStartH, day });
                              optionsRef.current = null; setOptions(null); setOptionsError(null);
                              if (crossDay) calendarApi.moveOptions(task.id, task.scheduled_stage ?? null, data.days.filter(x => x >= today && x !== day))
                                .then(r => { optionsRef.current = r.data; setOptions(r.data); })
                                .catch(err => { optionsRef.current = {}; setOptions({}); setOptionsError(err?.response?.data?.error || "Couldn't check other days."); });
                              (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            } : undefined}
                            onClick={() => { if (!dragRef.current && Date.now() - lastDragEnd.current > 400) onTaskClick(task); }}
                            style={{
                              position: 'absolute',
                              top, left: colLeft, width: colW, height,
                              background: isPlaceholder ? 'transparent' : pc.bg,
                              border: `1.5px ${isPlaceholder ? 'dashed' : 'solid'} ${pc.border}`,
                              borderRadius: 6,
                              padding: '3px 6px',
                              cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                              overflow: 'hidden',
                              zIndex: isDragging ? 10 : 2,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'flex-start',
                              boxSizing: 'border-box',
                              boxShadow: isDragging ? `0 0 0 2px ${TONE[verdict?.tone === 'bad' ? 'bad' : verdict?.tone === 'warn' ? 'risk' : 'ok'].color}, 0 4px 16px rgba(0,0,0,0.18)` : undefined,
                              opacity: awayDrag ? 0.35 : isDragging ? 0.92 : lockReason ? 0.75 : 1,
                              userSelect: 'none',
                              touchAction: 'none',
                            }}>
                            {/* Title row with icon */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, overflow: 'hidden' }}>
                              {task.event_type === 'recurring'
                                ? <Repeat size={10} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
                                : task.status === 'completed' || task.status === 'done'
                                ? <CheckCircle size={10} color="#22c55e" style={{ flexShrink: 0, marginTop: 1 }} />
                                : (() => { const Ic = pc.icon; return <Ic size={10} color={pc.color} style={{ flexShrink: 0, marginTop: 1 }} />; })()
                              }
                              <div style={{ fontSize: 11, fontWeight: 700, color: isPlaceholder ? pc.color : pc.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.title}</div>
                              {lockReason && <span style={{ fontSize: 9, flexShrink: 0 }}>🔒</span>}
                              {!lockReason && !!task.is_manual && <span style={{ fontSize: 9, flexShrink: 0 }} aria-label="Placed by hand">📌</span>}
                              {hTone && <span aria-label={health!.what} style={{ width: 7, height: 7, borderRadius: 99, background: TONE[hTone].color, flexShrink: 0, marginTop: 3 }} />}
                            </div>
                            {height > 34 && <div style={{ fontSize: 10, color: pc.color, opacity: 0.75 }}>{task.event_type === 'recurring' ? fmtHrs(hrs) : `${fmtHour(startH)} – ${fmtHour(endH)}`}</div>}
                            {height > 52 && (
                              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: pc.color, background: 'rgba(255,255,255,0.6)', borderRadius: 99, padding: '0px 4px' }}>{pc.label}</span>
                                {task.project_name && <span style={{ fontSize: 9, color: pc.color, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.project_name}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {crossDrag && dragPos!.day === day && dragRef.current!.day !== day && (() => {
                        const t = TONE[toneKey(dayOpt ? (dayOpt.allowed ? dayOpt.tone : 'bad') : day < today ? 'bad' : 'ok')];
                        return (
                          <div style={{ position: 'absolute', top: (dragPos!.startH - GRID_START) * ROW_H, left: 3, right: 3, height: Math.max(dragRef.current!.hrs * ROW_H - 3, 38), borderRadius: 6, border: `2px dashed ${t.color}`, background: 'var(--bg-white)', padding: '3px 6px', fontSize: 11, fontWeight: 700, color: t.color, zIndex: 10, pointerEvents: 'none', boxSizing: 'border-box', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
                            {dragRef.current!.title}
                            <div style={{ fontSize: 10, fontWeight: 600 }}>Start on {fmtDate(day)}</div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      {(dragPos || toast) && createPortal((() => {
        const v = dragPos ? verdictRef.current : null;
        const ao = crossAway ? options?.[dragPos!.day] : undefined;
        const tone = crossAway ? toneKey(dragPos!.day < today || optionsError ? 'bad' : ao ? (ao.allowed ? ao.tone : 'bad') : 'ok')
          : dragPos ? (v?.tone === 'bad' ? 'bad' : v?.tone === 'warn' ? 'risk' : 'ok') : toast!.tone === 'bad' ? 'bad' : 'ok';
        return (
          <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 5000, maxWidth: 'min(520px, calc(100vw - 32px))', background: '#fff', border: `1.5px solid ${TONE[tone].border}`, borderLeft: `4px solid ${TONE[tone].color}`, borderRadius: 10, padding: '10px 14px', boxShadow: '0 8px 28px rgba(0,0,0,0.16)', fontSize: 12, lineHeight: 1.45, color: 'var(--ink)', display: 'flex', gap: 12, alignItems: 'center' }}>
            {crossAway ? (() => {
              const o = options?.[dragPos!.day];
              if (dragPos!.day < today) return <div style={{ fontWeight: 800, color: TONE.bad.color }}>✕ That day has passed</div>;
              if (optionsError) return <div><div style={{ fontWeight: 800, color: TONE.bad.color }}>✕ Can't move to another day</div><div style={{ color: 'var(--ink-muted)' }}>{optionsError}</div></div>;
              if (!o) return <div style={{ color: 'var(--ink-muted)' }}>Checking what moving to {fmtDate(dragPos!.day)} would change…</div>;
              const t = TONE[toneKey(o.allowed ? o.tone : 'bad')];
              return (
                <div>
                  <div style={{ fontWeight: 800, color: t.color }}>{!o.allowed ? '🔒 ' : o.tone === 'ok' ? '✓ ' : o.tone === 'warn' ? '⚠ ' : '✕ '}{o.tone === 'ok' ? 'Safe to move here' : o.headline}</div>
                  {o.tone === 'warn' && o.changes.slice(0, 3).map((c, k) => <div key={k}>{c.label} → <b>{c.to}</b></div>)}
                  {o.tone === 'bad' && o.issues.filter(i => i.tone === 'bad').slice(0, 2).map((i, k) => <div key={k} style={{ color: 'var(--ink-muted)' }}>{i.why}</div>)}
                  {o.allowed && o.buffer != null && <div><b>{o.buffer < 0 ? `Short by ${fmtHrs(-o.buffer)}` : `Deadline buffer: ${fmtHrs(o.buffer)}`}</b></div>}
                  {o.allowed && o.tone !== 'ok' && <div style={{ color: 'var(--ink-muted)' }}>Release to see every change — nothing moves until you confirm.</div>}
                </div>
              );
            })() : dragPos && v ? (
              <div>
                <div style={{ fontWeight: 800, color: TONE[tone].color }}>{v.tone === 'ok' ? '✓ ' : v.tone === 'warn' ? '⚠ ' : '✕ '}{v.what}</div>
                {v.why && <div style={{ color: 'var(--ink-muted)' }}>{v.why}</div>}
                {v.fix && <div><b>What you can do:</b> {v.fix}</div>}
              </div>
            ) : toast && (
              <>
                <span style={{ flex: 1 }}>{toast.text}</span>
                {toast.undo && <button onClick={toast.undo} style={{ fontSize: 12, fontWeight: 800, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>Undo</button>}
              </>
            )}
          </div>
        );
      })(), document.body)}
      {confirm && createPortal((() => {
        const p = confirm.preview, t = TONE[toneKey(p.tone)];
        return (
          <div onClick={() => setConfirm(null)} style={{ position: 'fixed', inset: 0, zIndex: 5001, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div role="dialog" aria-modal="true" aria-labelledby="move-title" onClick={e => e.stopPropagation()} style={{ width: 'min(480px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#fff', borderRadius: 12, borderTop: `4px solid ${t.color}`, padding: 18, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', color: 'var(--ink)', fontSize: 13, lineHeight: 1.5 }}>
              <div id="move-title" style={{ fontSize: 15, fontWeight: 800, color: t.color, marginBottom: 2 }}>{p.tone === 'bad' ? '✕ ' : '⚠ '}{p.headline}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 12 }}>"{confirm.title}"</div>
              {p.moved && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 4 }}>What you're moving</div>
                  <div style={{ fontSize: 12, background: 'var(--bg-sand)', borderRadius: 8, padding: '6px 10px' }}><b>{p.moved.label}</b><div style={{ color: 'var(--ink-muted)' }}>{p.moved.from} → <b style={{ color: 'var(--ink)' }}>{p.moved.to}</b></div></div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {p.issues.map((i, k) => (
                  <div key={k} style={{ borderLeft: `3px solid ${TONE[toneKey(i.tone)].color}`, paddingLeft: 10 }}>
                    <div style={{ fontWeight: 700 }}>{i.what}</div>
                    <div style={{ color: 'var(--ink-muted)' }}>{i.why}</div>
                    {i.fix && <div><b>What you can do:</b> {i.fix}</div>}
                  </div>
                ))}
              </div>
              {p.changes.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 6 }}>What else changes ({p.changes.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {p.changes.map((c, k) => (
                      <div key={k} style={{ fontSize: 12, background: 'var(--bg-sand)', borderRadius: 8, padding: '6px 10px' }}>
                        <div style={{ fontWeight: 700 }}>{c.label}</div>
                        <div style={{ color: 'var(--ink-muted)' }}>{c.from} → <b style={{ color: 'var(--ink)' }}>{c.to}</b></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {p.deadlineAfter && (
                <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 14 }}>
                  <div><div style={{ color: 'var(--ink-muted)', fontWeight: 700 }}>Deadline before</div>{deadlineText(p.deadlineBefore)}</div>
                  <div><div style={{ color: 'var(--ink-muted)', fontWeight: 700 }}>Deadline after</div><b>{deadlineText(p.deadlineAfter)}</b></div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button autoFocus onClick={() => setConfirm(null)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--sand-border)', background: 'var(--bg-white)', color: 'var(--ink)', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => commitMove(confirm.taskId, confirm.stage, confirm.day, confirm.title)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: t.color, color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{p.tone === 'bad' ? 'Move anyway' : 'Apply move'}</button>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
    </div>
  );
}

// ─── Monthly view (existing logic, cleaned up) ───────────────────────────────
function MonthView({ year, month, onEventClick }: { year: number; month: number; onEventClick: (ev: any) => void }) {
  const [events, setEvents] = useState<{ tasks: any[]; recurring: any[] }>({ tasks: [], recurring: [] });
  const [loading, setLoading] = useState(false);
  const today = dateStr(new Date());

  useEffect(() => {
    setLoading(true);
    calendarApi.getEvents(toYM(year, month)).then(r => setEvents(r.data)).finally(() => setLoading(false));
  }, [year, month]);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays = new Date(year, month - 1, 0).getDate();
  const cells: { date: string; day: number; thisMonth: boolean }[] = [];
  const prevYM = month === 1 ? toYM(year - 1, 12) : toYM(year, month - 1);
  const nextYM = month === 12 ? toYM(year + 1, 1) : toYM(year, month + 1);
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ date: `${prevYM}-${String(prevDays - i).padStart(2,'0')}`, day: prevDays - i, thisMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${toYM(year, month)}-${String(d).padStart(2,'0')}`, day: d, thisMonth: true });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ date: `${nextYM}-${String(d).padStart(2,'0')}`, day: d, thisMonth: false });

  function dayEvents(date: string) { return [...events.tasks.filter(e => e.date === date), ...events.recurring.filter(e => e.date === date)]; }

  return (
    <div style={{ flex: 1 }}>
      {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>Loading…</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'var(--sand-border)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--sand-border)' }}>
        {WEEKDAYS.map(d => (
          <div key={d} style={{ background: 'var(--bg-sand)', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{d}</div>
        ))}
        {cells.map(cell => {
          const evs = dayEvents(cell.date);
          const visible = evs.slice(0, 3);
          const hidden = evs.length - 3;
          const isToday = cell.date === today;
          return (
            <div key={cell.date} style={{
              background: 'var(--bg-white)',
              minHeight: 90,
              padding: '6px 8px',
              opacity: cell.thisMonth ? 1 : 0.4,
              outline: isToday ? '2px solid var(--ink)' : 'none',
              outlineOffset: -2,
            }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--ink)' : 'var(--ink-muted)', marginBottom: 4 }}>{cell.day}</div>
              {visible.map((ev, i) => {
                const p = ev.priority || 'medium';
                const cfg = PRIORITY_CONFIG[p] || PRIORITY_CONFIG.medium;
                const isDone = ev.status === 'completed' || ev.status === 'done';
                return (
                  <div key={i} onClick={() => onEventClick(ev)} style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 5px', borderRadius: 4, marginBottom: 2,
                    background: isDone ? '#f0fdf4' : ev.event_type === 'recurring' ? 'rgba(99,102,241,0.1)' : cfg.bg,
                    color: isDone ? '#15803d' : ev.event_type === 'recurring' ? '#4f46e5' : cfg.color,
                    cursor: 'pointer', borderLeft: `2px solid ${isDone ? '#22c55e' : ev.event_type === 'recurring' ? '#818cf8' : cfg.color}`,
                    display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden',
                  }}>
                    {isDone
                      ? <CheckCircle size={9} style={{ flexShrink: 0 }} />
                      : ev.event_type === 'recurring'
                      ? <Repeat size={9} style={{ flexShrink: 0 }} />
                      : (() => { const Ic = cfg.icon; return <Ic size={9} style={{ flexShrink: 0 }} />; })()
                    }
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                  </div>
                );
              })}
              {hidden > 0 && <div style={{ fontSize: 9, color: 'var(--ink-muted)', fontWeight: 600 }}>+{hidden} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Calendar page ───────────────────────────────────────────────────────
export default function CalendarPage() {
  const { user } = useAuth();
  const today = new Date();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [monday, setMonday] = useState<Date>(() => getMondayOf(today));
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  function fmtHours(h: number) { const totalMin = Math.round(h * 60); const hr = Math.floor(totalMin / 60); const min = totalMin % 60; return hr > 0 && min > 0 ? `${hr}h ${min}m` : hr > 0 ? `${hr}h` : `${min}m`; }
  const [selected, setSelected] = useState<number | null>(null); // task ID for drawer
  const [selectedRecurring, setSelectedRecurring] = useState<any | null>(null); // recurring event info popup
  const [recurringList, setRecurringList] = useState<any[]>([]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const [form, setForm] = useState({
    title: '', description: '', doc_link: '', assigned_to: '', project_id: '',
    recurrence_type: 'weekly', recurrence_days: [] as number[],
    day_of_month: '1', start_date: dateStr(today),
    end_date: '', estimated_hours: '1', estimated_minutes: '0', priority: 'medium',
  });

  useEffect(() => {
    calendarApi.listRecurring().then(r => setRecurringList(r.data));
    projectsApi.list().then(r => setProjects(r.data));
    if (isManager) {
      usersApi.list().then(r => setUsers(r.data.filter((u: any) => u.role !== 'client')));
    }
  }, []);

  // Week navigation
  function prevWeek() { const d = new Date(monday); d.setDate(d.getDate() - 7); setMonday(d); }
  function nextWeek() { const d = new Date(monday); d.setDate(d.getDate() + 7); setMonday(d); }
  function goToday()  { setMonday(getMondayOf(today)); }

  // Month navigation
  function prevMonth() { if (month === 1) { setYear(y => y-1); setMonth(12); } else setMonth(m => m-1); }
  function nextMonth() { if (month === 12) { setYear(y => y+1); setMonth(1); } else setMonth(m => m+1); }

  function weekLabel() {
    const fri = new Date(monday); fri.setDate(monday.getDate() + 4);
    return `${fmtDDMMYYYY(monday)} – ${fmtDDMMYYYY(fri)}`;
  }


  function openCreate() {
    setEditing(null);
    setForm({ title:'', description:'', doc_link:'', assigned_to: String(user?.id||''), project_id:'', recurrence_type:'weekly', recurrence_days:[], day_of_month:'1', start_date:dateStr(today), end_date:'', estimated_hours:'1', estimated_minutes:'0', priority:'medium' });
    setModal(true);
  }
  function openEdit(rt: any) {
    setEditing(rt);
      const totalMins = Math.round((rt.estimated_hours || 1) * 60);
    setForm({ title:rt.title, description:rt.description||'', doc_link:rt.doc_link||'', assigned_to:String(rt.assigned_to), project_id:rt.project_id?String(rt.project_id):'', recurrence_type:rt.recurrence_type, recurrence_days:Array.isArray(rt.recurrence_days)?rt.recurrence_days:(rt.recurrence_days?JSON.parse(rt.recurrence_days):[]), day_of_month:String(rt.day_of_month||1), start_date:rt.start_date, end_date:rt.end_date||'', estimated_hours:String(Math.floor(totalMins/60)), estimated_minutes:String(totalMins%60 >= 45 ? 45 : totalMins%60 >= 30 ? 30 : totalMins%60 >= 15 ? 15 : 0), priority:rt.priority||'medium' });
    setModal(true);
  }
  async function saveForm() {
    const payload = { ...form, assigned_to:form.assigned_to?Number(form.assigned_to):undefined, project_id:form.project_id?Number(form.project_id):null, recurrence_days:form.recurrence_type==='weekly'?form.recurrence_days:[], day_of_month:form.recurrence_type==='monthly'?Number(form.day_of_month):null, end_date:form.end_date||null, estimated_hours:(Number(form.estimated_hours)||0)+(Number((form as any).estimated_minutes)||0)/60 || 1 };
      if (editing) await calendarApi.updateRecurring(editing.id, payload);
      else await calendarApi.createRecurring(payload);
      setModal(false);
      calendarApi.listRecurring().then(r => setRecurringList(r.data));
      setCalendarRefresh(n => n + 1);
    }
    async function deleteRt(id: number) {
      if (!confirm('Delete this recurring ticket?')) return;
      await calendarApi.deleteRecurring(id);
      calendarApi.listRecurring().then(r => setRecurringList(r.data));
      setCalendarRefresh(n => n + 1);
    }
  function toggleDay(d: number) { setForm(f => ({ ...f, recurrence_days: f.recurrence_days.includes(d) ? f.recurrence_days.filter(x=>x!==d) : [...f.recurrence_days,d] })); }

  return (
    <Layout>
      <div className="cal-page">
        {/* ── Header ── */}
        <div className="cal-header" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>My Calendar</h1>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>Your scheduled work — {DAY_CAP}h / day capacity</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {/* View toggle */}
            <div style={{ display: 'flex', background: 'var(--bg-sand)', borderRadius: 10, padding: 3, gap: 2, border: '1px solid var(--sand-border)' }}>
              {(['week','month'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: view===v ? 'var(--ink)' : 'transparent', color: view===v ? '#fff' : 'var(--ink-muted)', border: 'none', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {v === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>

            {/* Nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-white)', border: '1px solid var(--sand-border)', borderRadius: 10, padding: '4px 8px' }}>
              <button onClick={view==='week' ? prevWeek : prevMonth} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', color:'var(--ink-muted)', padding:4, borderRadius:6 }} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-sand)'} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='none'}>
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', minWidth: 160, textAlign: 'center' }}>
                {view === 'week' ? weekLabel() : `${MONTH_NAMES[month-1]} ${year}`}
              </span>
              <button onClick={view==='week' ? nextWeek : nextMonth} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', color:'var(--ink-muted)', padding:4, borderRadius:6 }} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--bg-sand)'} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='none'}>
                <ChevronRight size={16} />
              </button>
            </div>
            <button onClick={() => setShowRecurring(s => !s)} style={{ fontSize:12, fontWeight:600, color: showRecurring ? '#4f46e5' : 'var(--ink-muted)', background: showRecurring ? 'rgba(99,102,241,0.1)' : 'var(--bg-white)', border:`1px solid ${showRecurring ? '#c7d2fe' : 'var(--sand-border)'}`, borderRadius:10, padding:'6px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
              <Repeat size={13} /> Recurring ({recurringList.length})
            </button>
            <button className="btn-primary" style={{ fontSize:12, padding:'6px 14px' }} onClick={openCreate}>+ Recurring</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1, minHeight: 0 }}>
          {/* ── Main view ── */}
          {view === 'week' && (
            <WeekView monday={monday} refreshKey={calendarRefresh} onTaskClick={(task) => {
              if (task.event_type === 'recurring') {
                if (task.task_instance_id) { setSelected(task.task_instance_id); setSelectedRecurring(null); }
                else { setSelectedRecurring(task); setSelected(null); }
              } else {
                setSelected(task.id);
                setSelectedRecurring(null);
              }
            }} />
          )}
          {view === 'month' && (
            <MonthView year={year} month={month} onEventClick={(ev) => {
              if (ev.event_type === 'recurring') {
                if (ev.task_instance_id) { setSelected(ev.task_instance_id); setSelectedRecurring(null); }
                else { setSelectedRecurring(ev); setSelected(null); }
              } else {
                setSelected(ev.id);
                setSelectedRecurring(null);
              }
            }} />
          )}

          {/* ── Recurring sidebar ── */}
          {showRecurring && (
            <div style={{ width: 280, flexShrink: 0, background: 'var(--bg-white)', border: '1px solid var(--sand-border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--sand-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Recurring Tickets</span>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{recurringList.length}</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 480 }}>
                {recurringList.length === 0 && <p style={{ padding: 16, fontSize: 12, color: 'var(--ink-muted)' }}>None yet.</p>}
                {recurringList.map(rt => (
                  <div key={rt.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--bg-sand)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>{rt.title}</span>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={() => openEdit(rt)} style={{ fontSize: 10, padding: '2px 7px', background: 'var(--bg-sand)', border: '1px solid var(--sand-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--ink-muted)', fontWeight: 600 }}>Edit</button>
                        <button onClick={() => deleteRt(rt.id)} style={{ fontSize: 10, padding: '2px 7px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>Del</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ background: 'rgba(99,102,241,0.1)', color: '#4f46e5', borderRadius: 99, padding: '1px 7px', fontWeight: 600 }}>{describeRecurrence(rt)}</span>
                      {rt.project_name && <span>{rt.project_name}</span>}
                      <span>{fmtHours(rt.estimated_hours || 0)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>From {rt.start_date}{rt.end_date ? ` → ${rt.end_date}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Task detail panel ── */}
        {selected != null && (
          <TaskViewDrawer taskId={selected} onClose={() => setSelected(null)} />
        )}

        {/* ── Recurring event detail popup ── */}
        {selectedRecurring && (
          <div className="drawer-overlay">
            <div className="drawer-backdrop" onClick={() => setSelectedRecurring(null)} />
            <div className="drawer-panel">
              <div className="drawer-header">
                <div className="drawer-header__label">Recurring Ticket</div>
                <div className="drawer-header__row">
                  <Repeat size={16} color="#818cf8" />
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', flex: 1 }}>{selectedRecurring.title}</span>
                  <button type="button" className="drawer-close" onClick={() => setSelectedRecurring(null)}>×</button>
                </div>
              </div>
              <div className="drawer-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Date', value: selectedRecurring.date },
                  { label: 'Status', value: selectedRecurring.status },
                  { label: 'Estimated', value: selectedRecurring.estimated_hours ? fmtHours(selectedRecurring.estimated_hours) : '—' },
                  { label: 'Priority', value: selectedRecurring.priority || 'medium' },
                  { label: 'Assigned to', value: selectedRecurring.assigned_to_name || '—' },
                  { label: 'Project', value: selectedRecurring.project_name || '—' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#f8f5f0', borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', textTransform: 'capitalize' }}>{value}</div>
                  </div>
                ))}
              </div>
              {selectedRecurring.description && (
                <div style={{ background: '#f8f5f0', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selectedRecurring.description}</div>
                </div>
              )}
              {selectedRecurring.doc_link && (
                <div style={{ background: '#f8f5f0', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Doc Link</div>
                  <a href={selectedRecurring.doc_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, wordBreak: 'break-all' }}>{selectedRecurring.doc_link}</a>
                </div>
              )}
              <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: 0 }}>
                This recurring ticket hasn't been generated as an active ticket yet for this date. It will appear once the scheduler runs.
              </p>
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  onClick={async () => {
                    const rid = selectedRecurring.recurring_task_id || selectedRecurring.id;
                    if (rid) {
                      await deleteRt(rid);
                      setSelectedRecurring(null);
                    }
                  }}
                >
                  ⏹ Stop & Delete Recurring Ticket
                </button>
              </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Recurring task modal ── */}
        {modal && (
          <div className="drawer-overlay">
            <div className="drawer-backdrop" onClick={() => setModal(false)} />
            <div className="drawer-panel">
              <div className="drawer-header">
                <div className="drawer-header__label">{editing ? 'Edit Recurring Ticket' : 'New Recurring Ticket'}</div>
                <div className="drawer-header__row">
                  <div style={{ fontSize:18, fontWeight:800, color:'var(--ink)', flex:1 }}>{form.title.trim() || 'Repeats on a schedule'}</div>
                  <button type="button" className="drawer-close" onClick={()=>setModal(false)}>×</button>
                </div>
              </div>
              <div className="drawer-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Weekly report" autoFocus />
                </div>
                <div style={{ display:'grid', gridTemplateColumns: isManager ? '1fr 1fr' : '1fr', gap:12 }}>
                  {isManager && (
                    <div>
                      <label className="form-label">Assign To</label>
                      <select className="form-input" value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))}>
                        <option value={String(user?.id)}>Me ({user?.name})</option>
                        {users.filter(u=>u.id!==user?.id).map(u=><option key={u.id} value={String(u.id)}>{u.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="form-label">Project</label>
                    <select className="form-input" value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}>
                      <option value="">None</option>
                      {projects.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Recurrence</label>
                  <div style={{ display:'flex', gap:6 }}>
                    {(['daily','weekly','monthly'] as const).map(t=>(
                      <button key={t} type="button" onClick={()=>setForm(f=>({...f,recurrence_type:t}))} style={{ flex:1, padding:'7px 0', borderRadius:8, fontSize:12, fontWeight:600, background:form.recurrence_type===t?'var(--ink)':'var(--bg-sand)', color:form.recurrence_type===t?'#fff':'var(--ink-muted)', border:`1px solid ${form.recurrence_type===t?'var(--ink)':'var(--sand-border)'}`, cursor:'pointer' }}>
                        {t.charAt(0).toUpperCase()+t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {form.recurrence_type === 'weekly' && (
                  <div>
                    <label className="form-label">Repeat on</label>
                    <div style={{ display:'flex', gap:6 }}>
                      {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d,i)=>(
                        <button key={i} type="button" onClick={()=>toggleDay(i)} style={{ flex:1, padding:'6px 0', borderRadius:8, fontSize:11, fontWeight:700, background:form.recurrence_days.includes(i)?'var(--ink)':'var(--bg-sand)', color:form.recurrence_days.includes(i)?'#fff':'var(--ink-muted)', border:`1px solid ${form.recurrence_days.includes(i)?'var(--ink)':'var(--sand-border)'}`, cursor:'pointer' }}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                  <div>
                    <label className="form-label">Est. Time</label>
                    <div style={{ display:'flex', gap:4 }}>
                      <input className="form-input" type="number" min={0} step={1} style={{ width:'60%' }} placeholder="h" value={form.estimated_hours} onChange={e=>setForm(f=>({...f,estimated_hours:e.target.value}))} />
                      <input className="form-input" type="number" min={0} max={59} step={1} style={{ width:'40%' }} placeholder="min" value={(form as any).estimated_minutes||'0'} onChange={e=>setForm(f=>({...f,estimated_minutes:e.target.value}))} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Priority</label>
                    <select className="form-input" value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
                      {(['low','medium','high','urgent'] as const).map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">End Date <span style={{ fontWeight:400, textTransform:'none' }}>(optional)</span></label>
                    <input className="form-input" type="date" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Description <span style={{ fontWeight:400, textTransform:'none' }}>(optional)</span></label>
                  <textarea className="form-input" rows={3} style={{ resize:'vertical' }} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What needs to be done each time…" />
                </div>
                <div>
                  <label className="form-label">Doc Link <span style={{ fontWeight:400, textTransform:'none' }}>(optional)</span></label>
                  <input className="form-input" type="url" value={(form as any).doc_link} onChange={e=>setForm(f=>({...f,doc_link:e.target.value}))} placeholder="https://docs.google.com/…" />
                </div>
              </div>
              <div className="drawer-footer">
                <button type="button" className="drawer-submit" disabled={!form.title} onClick={saveForm}>{editing ? 'Save Changes' : 'Create Recurring Ticket'}</button>
                <button type="button" className="drawer-cancel" onClick={()=>setModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
