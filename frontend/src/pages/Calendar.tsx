import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout/Layout';
import { calendarApi, usersApi, projectsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { ChevronLeft, ChevronRight, Calendar, Clock, Repeat, CheckCircle, Zap, TrendingUp, Minus, AlertTriangle, FolderOpen } from 'lucide-react';
import '../css/pages/Calendar.css';

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
function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${parseInt(day)} ${MONTH_NAMES[parseInt(m)-1].slice(0,3)}`;
}
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
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: over ? '#dc2626' : 'var(--ink-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {used < 0.1 && used > 0 ? `${Math.round(used * 60)}m` : used.toFixed(1) + 'h'} / {DAY_CAP}h
        </span>
        {over && <span style={{ fontSize: 9, fontWeight: 800, color: '#dc2626' }}>OVER</span>}
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
      </div>
    </div>
  );
}

// ─── Weekly view ─────────────────────────────────────────────────────────────
function WeekView({ monday, onTaskClick }: { monday: Date; onTaskClick: (t: any) => void }) {
  const { user } = useAuth();
  const isOverview = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState<{ days: string[]; byDay: Record<string, any[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowPct, setNowPct] = useState(() => {
    const n = new Date(); return ((n.getHours() + n.getMinutes() / 60 - 9) / 10) * 100;
  });
  const today = dateStr(new Date());

  useEffect(() => {
    const tick = () => { const n = new Date(); setNowPct(((n.getHours() + n.getMinutes() / 60 - 9) / 10) * 100); };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    calendarApi.getWeek(dateStr(monday))
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || 'Failed to load week'))
      .finally(() => setLoading(false));
  }, [dateStr(monday)]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>Loading week…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>;
  if (!data) return null;

  // Compute warnings: overdue tasks and over-capacity days (employees only)
  const warningItems: string[] = [];
  for (const day of data.days) {
    const tasks = (data.byDay[day] || []).filter((t: any) => !t.is_placeholder && !t.is_overview);
    const used = tasks.reduce((s: number, t: any) => s + (Number(t.slot_hours ?? t.estimated_hours) || 0), 0);
    if (used > DAY_CAP) warningItems.push(`${fmtDate(day)} is over capacity (${used.toFixed(1)}h / 7h)`);
  }
  if (!isOverview) {
    const allTasks = Object.values(data.byDay).flat() as any[];
    const overdue = allTasks.filter(t => !t.is_placeholder && t.due_date < today && t.status !== 'completed' && t.event_type !== 'recurring');
    const overdueNames = [...new Set(overdue.map((t: any) => t.title))];
    for (const name of overdueNames) warningItems.push(`"${name}" is overdue`);
  }

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {warningItems.length > 0 && (
        <div style={{ background: 'rgba(220,38,38,0.06)', border: '1.5px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {warningItems.map((msg, i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>{msg}</span>
            ))}
          </div>
        </div>
      )}
      {/* Time grid — Google Calendar style */}
      {(() => {
        const fmtHour = (h: number) => { const hr = Math.floor(h); const min = Math.round((h - hr) * 60); const disp = hr % 12 || 12; const ampm = hr < 12 ? 'am' : 'pm'; return min > 0 ? `${disp}:${String(min).padStart(2,'0')}${ampm}` : `${disp}${ampm}`; };
        const GRID_START = 9;  // 9am
        const GRID_END   = 19; // 7pm
        const ROW_H      = 60; // px per hour
        const TIME_COL_W = 52; // px for time labels
        const nowHour = 9 + nowPct / 10; // derive from live state
        const hours   = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);

        // Compute start times per day by stacking tasks in priority order from 9am
        const dayBlocks: Record<string, { task: any; startH: number; endH: number }[]> = {};
        for (const day of data.days) {
          let cursor = GRID_START;
          dayBlocks[day] = [];
          for (const task of (data.byDay[day] || [])) {
            const hrs = Number(task.slot_hours ?? task.estimated_hours) || 1;
            const startH = cursor;
            const endH   = Math.min(startH + hrs, GRID_END);
            dayBlocks[day].push({ task, startH, endH });
            cursor = endH;
            if (cursor >= GRID_END) break;
          }
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
                  </div>
                );
              })}
            </div>

            {/* Scrollable time body */}
            <div style={{ overflowY: 'auto', maxHeight: 520 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `${TIME_COL_W}px repeat(5, 1fr)`, position: 'relative' }}>
                {/* Time labels + hour grid lines */}
                <div style={{ position: 'relative' }}>
                  {hours.map(h => (
                    <div key={h} style={{ height: ROW_H, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, borderTop: '1px solid var(--sand-border)', boxSizing: 'border-box' }}>
                      <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h % 12 || 12}{h < 12 ? 'am' : 'pm'}</span>
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {data.days.map((day) => {
                  const isToday = day === today;
                  const blocks = dayBlocks[day];
                  return (
                    <div key={day} style={{ position: 'relative', borderLeft: '1px solid var(--sand-border)', background: isToday ? 'rgba(37,99,235,0.02)' : 'var(--bg-white)' }}>
                      {/* Hour grid lines */}
                      {hours.map(h => (
                        <div key={h} style={{ height: ROW_H, borderTop: '1px solid var(--sand-border)', boxSizing: 'border-box' }} />
                      ))}

                      {/* Current time indicator */}
                      {isToday && nowHour >= GRID_START && nowHour <= GRID_END && (
                        <div style={{ position: 'absolute', top: `${nowPct}%`, left: 0, right: 0, height: 2, background: '#2563eb', zIndex: 10, pointerEvents: 'none' }}>
                          <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />
                        </div>
                      )}

                      {/* Task blocks */}
                      {blocks.map(({ task, startH, endH }, j) => {
                        const top    = (startH - GRID_START) * ROW_H;
                        const height = Math.max((endH - startH) * ROW_H - 3, 22);
                        const pc     = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                        const isPlaceholder = task.is_placeholder;
                        return (
                          <div key={task.id || j} onClick={() => onTaskClick(task)} style={{
                            position: 'absolute',
                            top, left: 3, right: 3, height,
                            background: isPlaceholder ? 'transparent' : pc.bg,
                            border: `1.5px ${isPlaceholder ? 'dashed' : 'solid'} ${pc.border}`,
                            borderRadius: 6,
                            padding: '3px 6px',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            zIndex: 2,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                            boxSizing: 'border-box',
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: pc.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                            {height > 30 && <div style={{ fontSize: 10, color: pc.color, opacity: 0.75 }}>{fmtHour(startH)} – {fmtHour(endH)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Monthly view (existing logic, cleaned up) ───────────────────────────────
function MonthView({ year, month, onEventClick }: { year: number; month: number; onEventClick: (e: any) => void }) {
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
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    cursor: 'pointer', borderLeft: `2px solid ${isDone ? '#22c55e' : ev.event_type === 'recurring' ? '#818cf8' : cfg.color}`,
                  }}>
                    {ev.title}
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
  const [selected, setSelected] = useState<any | null>(null);
  const [recurringList, setRecurringList] = useState<any[]>([]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const [form, setForm] = useState({
    title: '', description: '', assigned_to: '', project_id: '',
    recurrence_type: 'weekly', recurrence_days: [] as number[],
    day_of_month: '1', start_date: dateStr(today),
    end_date: '', estimated_hours: '1', priority: 'medium',
  });

  useEffect(() => {
    calendarApi.listRecurring().then(r => setRecurringList(r.data));
    if (isManager) {
      usersApi.list().then(r => setUsers(r.data.filter((u: any) => u.role !== 'client')));
      projectsApi.list().then(r => setProjects(r.data));
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
    const m1 = MONTH_NAMES[monday.getMonth()].slice(0,3);
    const m2 = MONTH_NAMES[fri.getMonth()].slice(0,3);
    const sameMonth = monday.getMonth() === fri.getMonth();
    return sameMonth
      ? `${m1} ${monday.getDate()} – ${fri.getDate()}, ${monday.getFullYear()}`
      : `${m1} ${monday.getDate()} – ${m2} ${fri.getDate()}, ${monday.getFullYear()}`;
  }

  function openCreate() {
    setEditing(null);
    setForm({ title:'', description:'', assigned_to: String(user?.id||''), project_id:'', recurrence_type:'weekly', recurrence_days:[], day_of_month:'1', start_date:dateStr(today), end_date:'', estimated_hours:'1', priority:'medium' });
    setModal(true);
  }
  function openEdit(rt: any) {
    setEditing(rt);
    setForm({ title:rt.title, description:rt.description||'', assigned_to:String(rt.assigned_to), project_id:rt.project_id?String(rt.project_id):'', recurrence_type:rt.recurrence_type, recurrence_days:Array.isArray(rt.recurrence_days)?rt.recurrence_days:(rt.recurrence_days?JSON.parse(rt.recurrence_days):[]), day_of_month:String(rt.day_of_month||1), start_date:rt.start_date, end_date:rt.end_date||'', estimated_hours:String(rt.estimated_hours||1), priority:rt.priority||'medium' });
    setModal(true);
  }
  async function saveForm() {
    const payload = { ...form, assigned_to:form.assigned_to?Number(form.assigned_to):undefined, project_id:form.project_id?Number(form.project_id):null, recurrence_days:form.recurrence_type==='weekly'?form.recurrence_days:[], day_of_month:form.recurrence_type==='monthly'?Number(form.day_of_month):null, end_date:form.end_date||null, estimated_hours:Number(form.estimated_hours)||1 };
    if (editing) await calendarApi.updateRecurring(editing.id, payload);
    else await calendarApi.createRecurring(payload);
    setModal(false);
    calendarApi.listRecurring().then(r => setRecurringList(r.data));
  }
  async function deleteRt(id: number) {
    if (!confirm('Delete this recurring task?')) return;
    await calendarApi.deleteRecurring(id);
    calendarApi.listRecurring().then(r => setRecurringList(r.data));
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
              <button onClick={view==='week' ? goToday : () => { setYear(today.getFullYear()); setMonth(today.getMonth()+1); }} style={{ fontSize:11, fontWeight:700, color:'var(--ink)', background:'var(--bg-sand)', border:'1px solid var(--sand-border)', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>Today</button>
            </div>

            <button onClick={async () => { await calendarApi.schedule(); }} title="Re-run scheduling algorithm" style={{ fontSize:12, fontWeight:600, color:'var(--ink-muted)', background:'var(--bg-white)', border:'1px solid var(--sand-border)', borderRadius:10, padding:'6px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
              <Calendar size={13} /> Schedule
            </button>
            <button onClick={() => setShowRecurring(s => !s)} style={{ fontSize:12, fontWeight:600, color: showRecurring ? '#4f46e5' : 'var(--ink-muted)', background: showRecurring ? 'rgba(99,102,241,0.1)' : 'var(--bg-white)', border:`1px solid ${showRecurring ? '#c7d2fe' : 'var(--sand-border)'}`, borderRadius:10, padding:'6px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
              <Repeat size={13} /> Recurring ({recurringList.length})
            </button>
            <button className="btn-primary" style={{ fontSize:12, padding:'6px 14px' }} onClick={openCreate}>+ Recurring</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1, minHeight: 0 }}>
          {/* ── Main view ── */}
          {view === 'week' && (
            <WeekView monday={monday} onTaskClick={setSelected} />
          )}
          {view === 'month' && (
            <MonthView year={year} month={month} onEventClick={setSelected} />
          )}

          {/* ── Recurring sidebar ── */}
          {showRecurring && (
            <div style={{ width: 280, flexShrink: 0, background: 'var(--bg-white)', border: '1px solid var(--sand-border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--sand-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Recurring Tasks</span>
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
                      <span>{rt.estimated_hours}h</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>From {rt.start_date}{rt.end_date ? ` → ${rt.end_date}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Task detail panel ── */}
        {selected && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)' }} />
            <div onClick={e => e.stopPropagation()} style={{ position: 'relative', width: 340, height: '100%', background: 'linear-gradient(160deg,rgba(255,255,255,0.97),rgba(248,246,242,0.97))', borderLeft: '1px solid rgba(255,255,255,0.8)', boxShadow: '-8px 0 32px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', animation: 'drawerIn 0.22s ease' }}>
              <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--sand-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 4 }}>Task Detail</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.3 }}>{selected.title}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'var(--bg-sand)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)', fontSize: 16 }}>×</button>
              </div>
              <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Status */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: selected.status === 'completed' ? '#f0fdf4' : selected.event_type === 'recurring' ? 'rgba(99,102,241,0.1)' : (PRIORITY_CONFIG[selected.priority]?.bg || '#f9fafb'), border: `1px solid ${selected.status === 'completed' ? '#bbf7d0' : selected.event_type === 'recurring' ? '#c7d2fe' : (PRIORITY_CONFIG[selected.priority]?.border || '#e5e7eb')}`, borderRadius: 99, padding: '4px 12px', width: 'fit-content' }}>
                  {selected.event_type === 'recurring' ? <Repeat size={12} color="#818cf8" /> : <CheckCircle size={12} color={PRIORITY_CONFIG[selected.priority]?.color || '#6b7280'} />}
                  <span style={{ fontSize: 11, fontWeight: 700, color: selected.event_type === 'recurring' ? '#4f46e5' : (PRIORITY_CONFIG[selected.priority]?.color || '#6b7280'), textTransform: 'capitalize' }}>
                    {selected.event_type === 'recurring' ? 'Recurring' : selected.priority} · {selected.status}
                  </span>
                </div>

                {[
                  { label: 'Due Date',    value: selected.due_date },
                  { label: 'Project',     value: selected.project_name },
                  { label: 'Est. Hours',  value: selected.estimated_hours ? `${selected.estimated_hours}h` : null },
                  { label: 'Logged',      value: selected.tracked_seconds > 0 ? fmtSec(selected.tracked_seconds) : null },
                ].filter(r => r.value).map(row => (
                  <div key={row.label}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: 3 }}>{row.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{row.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Recurring task modal ── */}
        {modal && (
          <div style={{ position:'fixed', inset:0, zIndex:600, background:'rgba(0,0,0,0.3)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setModal(false)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:20, width:480, maxWidth:'95vw', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
              <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid var(--sand-border)' }}>
                <div style={{ fontSize:16, fontWeight:800, color:'var(--ink)' }}>{editing ? 'Edit Recurring Task' : 'New Recurring Task'}</div>
              </div>
              <div style={{ padding:'20px 24px', overflowY:'auto', display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Weekly report" autoFocus />
                </div>
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
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div>
                    <label className="form-label">Est. Hours</label>
                    <input className="form-input" type="number" min={0.5} max={24} step={0.5} value={form.estimated_hours} onChange={e=>setForm(f=>({...f,estimated_hours:e.target.value}))} />
                  </div>
                  <div>
                    <label className="form-label">Priority</label>
                    <select className="form-input" value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
                      {(['low','medium','high','urgent'] as const).map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">End Date <span style={{ fontWeight:400, textTransform:'none' }}>(optional)</span></label>
                  <input className="form-input" type="date" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} />
                </div>
              </div>
              <div style={{ padding:'14px 24px', borderTop:'1px solid var(--sand-border)', display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button className="btn-secondary" onClick={()=>setModal(false)}>Cancel</button>
                <button className="btn-primary" disabled={!form.title} onClick={saveForm}>{editing ? 'Save Changes' : 'Create'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
