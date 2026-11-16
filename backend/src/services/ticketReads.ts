// Read-only ticket lookups for the assistant. Visibility is whatever the existing list and detail services already enforce.
import { Knex } from 'knex';
import { Actor } from './access';
import { listTasks, getTask } from './tasks';

export interface TicketBrief { id: number; title: string; status: string; priority: string; due_date: string | null; project: string | null; assignee: string | null }
export interface TicketDetail extends TicketBrief { description: string | null; estimated_hours: number | null; checklist_done: number; checklist_total: number }

const SEARCH_LIMIT = 10;

export async function searchTickets(db: Knex, actor: Actor, text: string): Promise<{ total: number; items: TicketBrief[] }> {
  // An empty search is not a request for everything
  if (!text.trim()) return { total: 0, items: [] };
  const rows: any[] = await listTasks(db, actor, { title: text });
  return {
    total: rows.length,
    items: rows.slice(0, SEARCH_LIMIT).map((r) => ({
      id: Number(r.id), title: r.title, status: r.status, priority: r.priority, due_date: r.due_date ?? null,
      project: r.project_name ?? null, assignee: r.assigned_name ?? null,
    })),
  };
}

// The employee's own open tickets, using the same visibility rules as the list
export async function listMyTasks(db: Knex, actor: Actor): Promise<{ total: number; items: TicketBrief[] }> {
  const rows: any[] = (await listTasks(db, actor, { assigned_to: actor.id })).filter((r: any) => r.status !== 'completed');
  return {
    total: rows.length,
    items: rows.slice(0, SEARCH_LIMIT).map((r) => ({
      id: Number(r.id), title: r.title, status: r.status, priority: r.priority, due_date: r.due_date ?? null,
      project: r.project_name ?? null, assignee: r.assigned_name ?? null,
    })),
  };
}

// Throws ServiceError(404) for anything the caller cannot see, so existence is not revealed
export async function viewTicket(db: Knex, actor: Actor, id: number): Promise<TicketDetail> {
  const t: any = await getTask(db, actor, id);
  const checklist: any[] = t.checklist ?? [];
  return {
    id: Number(t.id), title: t.title, status: t.status, priority: t.priority, due_date: t.due_date ?? null,
    project: t.project_name ?? null, assignee: t.assigned_name ?? null, description: t.description ?? null,
    estimated_hours: t.estimated_hours != null ? Number(t.estimated_hours) : null,
    checklist_done: checklist.filter((c) => !!c.completed).length, checklist_total: checklist.length,
  };
}
