import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout/Layout';
import { calendarApi, usersApi, projectsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiUser, FiFolder, FiClock, FiRepeat, FiCheckCircle } from 'react-icons/fi';
import '../css/pages/Calendar.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PRIORITIES = ['low','medium','high','urgent'];

function toYM(y: number, m: number) { return `${y}-${String(m).padStart(2,'0')}`; }

function describeRecurrence(rt: any) {
  if (rt.recurrence_type === 'daily') return 'Every day';
  if (rt.recurrence_type === 'monthly') return `Monthly on day ${rt.day_of_month || 1}`;
  const days: number[] = Array.isArray(rt.recurrence_days) ? rt.recurrence_days : (rt.recurrence_days ? JSON.parse(rt.recurrence_days) : []);
  if (!days.length) return 'Weekly';
  return 'Every ' + days.map(d => WEEKDAYS[d]).join(', ');
}

export default function CalendarPage() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [tab, setTab] = useState<'all' | 'tasks' | 'recurring'>('all');
  const [events, setEvents] = useState<{ tasks: any[]; recurring: any[] }>({ tasks: [], recurring: [] });
  const [recurringList, setRecurringList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [popup, setPopup] = useState<{ event: any; x: number; y: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);

  // form state
  const [form, setForm] = useState({
    title: '', description: '', assigned_to: '', project_id: '',
    recurrence_type: 'weekly', recurrence_days: [] as number[],
    day_of_month: '1', start_date: today.toISOString().slice(0, 10),
    end_date: '', estimated_hours: '1', priority: 'medium',
  });

  const isManager = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    fetchEvents();
    fetchRecurring();
    if (isManager) {
      usersApi.list().then(r => setUsers(r.data.filter((u: any) => u.role !== 'client')));
      projectsApi.list().then(r => setProjects(r.data));
    }
  }, [year, month]);

  async function fetchEvents() {
    setLoading(true);
    try {
      const r = await calendarApi.getEvents(toYM(year, month));
      setEvents(r.data);
    } finally { setLoading(false); }
  }

  async function fetchRecurring() {
    const r = await calendarApi.listRecurring();
    setRecurringList(r.data);
  }

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  function openCreate() {
    setEditing(null);
    setForm({ title: '', description: '', assigned_to: String(user?.id || ''), project_id: '', recurrence_type: 'weekly', recurrence_days: [], day_of_month: '1', start_date: today.toISOString().slice(0, 10), end_date: '', estimated_hours: '1', priority: 'medium' });
    setModal(true);
  }

  function openEdit(rt: any) {
    setEditing(rt);
    setForm({
      title: rt.title, description: rt.description || '',
      assigned_to: String(rt.assigned_to), project_id: rt.project_id ? String(rt.project_id) : '',
      recurrence_type: rt.recurrence_type,
      recurrence_days: Array.isArray(rt.recurrence_days) ? rt.recurrence_days : (rt.recurrence_days ? JSON.parse(rt.recurrence_days) : []),
      day_of_month: String(rt.day_of_month || 1),
      start_date: rt.start_date, end_date: rt.end_date || '',
      estimated_hours: String(rt.estimated_hours || 1), priority: rt.priority || 'medium',
    });
    setModal(true);
  }

  async function saveForm() {
    const payload = {
      ...form,
      start_date: today.toISOString().slice(0, 10),
      assigned_to: form.assigned_to ? Number(form.assigned_to) : undefined,
      project_id: form.project_id ? Number(form.project_id) : null,
      recurrence_days: form.recurrence_type === 'weekly' ? form.recurrence_days : [],
      day_of_month: form.recurrence_type === 'monthly' ? Number(form.day_of_month) : null,
      end_date: form.end_date || null,
      estimated_hours: Number(form.estimated_hours) || 1,
    };
    if (editing) {
      await calendarApi.updateRecurring(editing.id, payload);
    } else {
      await calendarApi.createRecurring(payload);
    }
    setModal(false);
    fetchRecurring();
    fetchEvents();
  }

  async function deleteRt(id: number) {
    if (!confirm('Delete this recurring task? Future instances will not be created.')) return;
    await calendarApi.deleteRecurring(id);
    fetchRecurring();
    fetchEvents();
  }

  function toggleDay(d: number) {
    setForm(f => ({
      ...f,
      recurrence_days: f.recurrence_days.includes(d) ? f.recurrence_days.filter(x => x !== d) : [...f.recurrence_days, d],
    }));
  }

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays = new Date(year, month - 1, 0).getDate();

  const cells: { date: string; day: number; thisMonth: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ date: `${toYM(year, month === 1 ? year - 1 : year)}-${String(prevDays - i).padStart(2,'0')}`, day: prevDays - i, thisMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${toYM(year, month)}-${String(d).padStart(2,'0')}`, day: d, thisMonth: true });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ date: `${toYM(year, month === 12 ? year + 1 : year)}-${String(d).padStart(2,'0')}`, day: d, thisMonth: false });

  function eventsForDate(date: string) {
    const tasks = events.tasks.filter(e => e.date === date);
    const recurring = events.recurring.filter(e => e.date === date);
    if (tab === 'tasks') return { tasks, recurring: [] };
    if (tab === 'recurring') return { tasks: [], recurring };
    return { tasks, recurring };
  }

  function eventClass(e: any) {
    if (e.status === 'done' || e.status === 'completed') return 'cal-event cal-event--done';
    if (e.event_type === 'recurring') return 'cal-event cal-event--recurring';
    return 'cal-event cal-event--task';
  }

  const todayStr = today.toISOString().slice(0, 10);

  return (
    <Layout>
      <div className="cal-page">
        <div className="cal-header">
          <h1>Calendar</h1>
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
            <span className="cal-month-label">{MONTH_NAMES[month - 1]} {year}</span>
            <button className="cal-nav-btn" onClick={nextMonth}>›</button>
            <button className="cal-nav-btn" style={{ fontWeight: 600, fontSize: 13, padding: '6px 14px' }} onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}>Today</button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="cal-tabs">
              <button className={`cal-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>All</button>
              <button className={`cal-tab${tab === 'tasks' ? ' active' : ''}`} onClick={() => setTab('tasks')}>Tasks</button>
              <button className={`cal-tab${tab === 'recurring' ? ' active' : ''}`} onClick={() => setTab('recurring')}>Recurring</button>
            </div>
            <button className="btn-primary" style={{ fontSize: 13, padding: '7px 16px' }} onClick={openCreate}>+ Recurring Task</button>
          </div>
        </div>

        {loading && <p style={{ color: 'var(--ink-muted)', fontSize: 13, marginBottom: 12 }}>Loading…</p>}

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="cal-grid" style={{ flex: 1, minWidth: 0 }} onClick={() => setPopup(null)}>
          <div className="cal-weekdays">
            {WEEKDAYS.map(d => <div key={d} className="cal-weekday">{d}</div>)}
          </div>
          <div className="cal-days">
            {cells.map(cell => {
              const { tasks: dayTasks, recurring: dayRecurring } = eventsForDate(cell.date);
              const allEvents = [...dayTasks, ...dayRecurring];
              const visible = allEvents.slice(0, 3);
              const hidden = allEvents.length - 3;
              const isSelected = selectedDate === cell.date;
              return (
                <div
                  key={cell.date}
                  className={`cal-day${!cell.thisMonth ? ' cal-day--other-month' : ''}${cell.date === todayStr ? ' cal-day--today' : ''}${isSelected ? ' cal-day--selected' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setPopup(null); setSelectedDate(prev => prev === cell.date ? null : cell.date); }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="cal-day-num">{cell.day}</div>
                  {visible.map((ev, i) => (
                    <div
                      key={i}
                      className={eventClass(ev)}
                      title={ev.title}
                      onClick={(e) => { e.stopPropagation(); const rect = (e.target as HTMLElement).getBoundingClientRect(); setPopup({ event: ev, x: rect.left, y: rect.bottom + 4 }); }}
                    >
                      <span className="cal-event-dot" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</span>
                    </div>
                  ))}
                  {hidden > 0 && <div className="cal-more">+{hidden} more</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Day detail drawer */}
        {selectedDate && (() => {
          const { tasks: dayTasks, recurring: dayRecurring } = eventsForDate(selectedDate);
          const allEvents = [...dayTasks, ...dayRecurring];
          const [dy, dm, dd] = selectedDate.split('-');
          const label = `${parseInt(dd)} ${MONTH_NAMES[parseInt(dm) - 1]} ${dy}`;
          return (
            <div className="cal-day-drawer">
              <div className="cal-day-drawer-head">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{allEvents.length} event{allEvents.length !== 1 ? 's' : ''}</div>
                </div>
                <button onClick={() => setSelectedDate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-muted)', lineHeight: 1 }}>×</button>
              </div>
              <div className="cal-day-drawer-body">
                {allEvents.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No tasks on this day.</p>}
                {allEvents.map((ev, i) => (
                  <div key={i} className="cal-day-drawer-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className={`cal-event-dot${ev.event_type === 'recurring' ? ' cal-event-dot--recurring' : ''}`} style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', flex: 1 }}>{ev.title}</span>
                      {(ev.status === 'completed' || ev.status === 'done') && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#257a50', background: 'rgba(76,175,125,0.14)', borderRadius: 99, padding: '2px 7px' }}><FiCheckCircle size={10} />Done</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', paddingLeft: 18 }}>
                      {ev.assigned_to_name && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FiUser size={11} />{ev.assigned_to_name}</span>}
                      {ev.project_name && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FiFolder size={11} />{ev.project_name}</span>}
                      {ev.estimated_hours && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FiClock size={11} />{ev.estimated_hours}h</span>}
                      {ev.event_type === 'recurring' && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><FiRepeat size={11} />Recurring</span>}
                      {ev.priority && <span style={{ textTransform: 'capitalize' }}>· {ev.priority}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        </div>

        {/* Recurring task list */}
        <div className="cal-recurring-list">
          <div className="cal-recurring-header">
            <h2>Recurring Tasks ({recurringList.length})</h2>
          </div>
          {recurringList.length === 0 && <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No recurring tasks yet. Click "+ Recurring Task" to create one.</p>}
          <div className="cal-rt-grid">
            {recurringList.map(rt => (
              <div key={rt.id} className="cal-rt-card">
                <div className="cal-rt-card-title">{rt.title}</div>
                <div className="cal-rt-card-meta">
                  <span className="cal-rt-badge">{describeRecurrence(rt)}</span>
                  {rt.project_name && <span>· {rt.project_name}</span>}
                  <span>· {rt.estimated_hours}h</span>
                  {rt.assigned_to_name && <span>· {rt.assigned_to_name}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  From {rt.start_date}{rt.end_date ? ` → ${rt.end_date}` : ' (no end)'}
                </div>
                <div className="cal-rt-actions">
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => openEdit(rt)}>Edit</button>
                  <button className="btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => deleteRt(rt.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Event popup */}
        {popup && (
          <div ref={popupRef} className="cal-popup" style={{ position: 'fixed', top: popup.y, left: Math.min(popup.x, window.innerWidth - 260) }} onClick={e => e.stopPropagation()}>
            <h3>{popup.event.title}</h3>
            {popup.event.assigned_to_name && <div className="cal-popup-meta">👤 {popup.event.assigned_to_name}</div>}
            {popup.event.project_name && <div className="cal-popup-meta">📁 {popup.event.project_name}</div>}
            {popup.event.estimated_hours && <div className="cal-popup-meta">⏱ {popup.event.estimated_hours}h estimated</div>}
            <div className="cal-popup-meta">
              {popup.event.event_type === 'recurring' ? '🔁 Recurring' : '✅ Task'} · {popup.event.priority || 'medium'} priority · {popup.event.status}
            </div>
            {popup.event.task_instance_id && (
              <div style={{ marginTop: 8 }}>
                <a href="/tasks" style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', fontWeight: 600 }}>Open in My Tasks →</a>
              </div>
            )}
          </div>
        )}

        {/* Create / Edit modal */}
        {modal && (
          <div className="cal-modal-backdrop" onClick={() => setModal(false)}>
            <div className="cal-modal" onClick={e => e.stopPropagation()}>
              <div className="cal-modal-head">
                <h2>{editing ? 'Edit Recurring Task' : 'New Recurring Task'}</h2>
              </div>

              <div className="cal-modal-body">
                <div className="cal-form-row">
                  <label className="cal-label">Title *</label>
                  <input className="cal-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Post blog every Monday" autoFocus />
                </div>

                <div className="cal-form-row">
                  <label className="cal-label">Description</label>
                  <textarea className="cal-input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes" style={{ resize: 'vertical' }} />
                </div>

                <div className="cal-form-2col">
                  {isManager && (
                    <div className="cal-form-row">
                      <label className="cal-label">Assign To</label>
                      <select className="cal-input" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                        <option value={String(user?.id)}>Me ({user?.name})</option>
                        {users.filter(u => u.id !== user?.id).map(u => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="cal-form-row">
                    <label className="cal-label">Project</label>
                    <select className="cal-input" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                      <option value="">None</option>
                      {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="cal-form-row">
                  <label className="cal-label">Recurrence</label>
                  <div className="cal-recurrence-tabs">
                    {(['daily','weekly','monthly'] as const).map(t => (
                      <button key={t} type="button" className={`cal-recurrence-tab${form.recurrence_type === t ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, recurrence_type: t }))}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {form.recurrence_type === 'weekly' && (
                  <div className="cal-form-row">
                    <label className="cal-label">Repeat on</label>
                    <div className="cal-days-picker">
                      {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => (
                        <button key={i} type="button" className={`cal-day-chip${form.recurrence_days.includes(i) ? ' selected' : ''}`} onClick={() => toggleDay(i)}>{d}</button>
                      ))}
                    </div>
                  </div>
                )}

                {form.recurrence_type === 'monthly' && (
                  <div className="cal-form-row">
                    <label className="cal-label">Day of month</label>
                    <input className="cal-input" type="number" min={1} max={31} value={form.day_of_month} onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))} style={{ maxWidth: 100 }} />
                  </div>
                )}

                <div className="cal-form-row">
                  <label className="cal-label">End Date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — leave blank for no end)</span></label>
                  <input className="cal-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>

              <div className="cal-modal-footer">
                <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
                <button className="btn-primary" disabled={!form.title} onClick={saveForm}>
                  {editing ? 'Save Changes' : 'Create Recurring Task'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
