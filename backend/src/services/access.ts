// Shared authorization for tasks and projects. The website routes and the assistant both call these,
// so there is one definition of "who can see / change what". Rules mirror the existing website behaviour.
import { Knex } from 'knex';
import { Response } from 'express';

export interface Actor { id: number; role: string; name?: string; email?: string; pod?: string | null }

export const STAFF = ['admin', 'manager', 'employee'];

export class ServiceError extends Error {
  constructor(public readonly status: number, message: string, public readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function sendServiceError(res: Response, err: unknown, label = 'request'): void {
  if (err instanceof ServiceError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
  console.error(`[${label}]`, err);
  res.status(500).json({ error: 'Server error' });
}

// ── Projects ──

type Scope = (q: Knex.QueryBuilder, alias?: string) => Knex.QueryBuilder;

// Same scope as GET /api/projects (the website's project list). Lookups happen here; the returned function
// only adds WHERE clauses. (An async function must never return a query builder: awaiting it runs the query.)
export async function projectScope(db: Knex, actor: Actor): Promise<Scope> {
  const { role, id } = actor;
  if (role === 'admin') return (q) => q;
  if (role === 'client') {
    const me = await db('users').where({ id }).select('client_company_id').first();
    const memberIds: number[] = await db('project_members').where({ user_id: id }).pluck('project_id');
    return (q, alias = 'p') => q.where(function (this: any) {
      this.whereIn(`${alias}.id`, memberIds);
      if (me?.client_company_id) this.orWhere(`${alias}.client_company_id`, me.client_company_id);
    });
  }
  if (role === 'employee') {
    return (q, alias = 'p') => q.whereIn(`${alias}.id`, db('project_members').where({ user_id: id }).select('project_id'));
  }
  if (role === 'manager') {
    const me = await db('users').where({ id }).select('pod').first();
    const memberIds: number[] = await db('project_members').where({ user_id: id }).pluck('project_id');
    return (q, alias = 'p') => q.where(function (this: any) {
      if (me?.pod) this.where(`${alias}.pod`, me.pod);
      if (memberIds.length) this.orWhereIn(`${alias}.id`, memberIds);
    });
  }
  return (q) => q.whereRaw('1 = 0');
}

export async function canSeeProject(db: Knex, actor: Actor, projectId: number | string): Promise<boolean> {
  const scope = await projectScope(db, actor);
  return !!(await scope(db('projects as p').where('p.id', projectId)).first('p.id'));
}

// Website: admins manage every project; managers manage the projects in their list (Projects page edit/delete).
export async function canManageProject(db: Knex, actor: Actor, projectId: number | string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'manager') return false;
  return canSeeProject(db, actor, projectId);
}

// Money is only shown to admins and managers on the website
export const FINANCIAL_FIELDS = ['budget_amount', 'budget_cutoff_pct', 'working_budget', 'total_spend', 'amount_remaining', 'budget_used_pct', 'health_flag'] as const;
export function canSeeFinancials(actor: Actor): boolean { return actor.role === 'admin' || actor.role === 'manager'; }
export function stripFinancials<T extends Record<string, any>>(project: T, actor: Actor): T {
  if (canSeeFinancials(actor)) return project;
  const out: Record<string, any> = { ...project };
  for (const f of FINANCIAL_FIELDS) delete out[f];
  return out as T;
}

// ── Tasks ──

// Drafts (and requests rejected back to their author) belong to their creator only
export function applyDraftScope(q: Knex.QueryBuilder, actor: Actor): Knex.QueryBuilder {
  return q.where(function (this: any) { this.whereNot('t.status', 'draft').orWhere('t.created_by', actor.id); });
}

// Client ticket rule, shared by the client's ticket list and by opening a single ticket (needs `p` joined):
// tickets of projects the client is a member of, or of their company's projects. Both places use this one rule.
export async function clientListScope(db: Knex, actor: Actor): Promise<(q: Knex.QueryBuilder) => Knex.QueryBuilder> {
  const clientUser = await db('users').where({ id: actor.id }).select('client_company_id').first();
  const memberProjectIds: number[] = await db('project_members').where({ user_id: actor.id }).pluck('project_id');
  return (q) => q.where(function (this: any) {
    this.whereIn('t.project_id', memberProjectIds);
    if (clientUser?.client_company_id) this.orWhere('p.client_company_id', clientUser.client_company_id);
  });
}

// Client view of tasks (needs `p` joined): their projects, and tickets only once every stage person has accepted
export async function clientTaskScope(db: Knex, actor: Actor): Promise<Scope> {
  const projects = await projectScope(db, actor);
  return (q) => projects(q.whereRaw(
    `(t.ticket_type_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM task_assignees ta2
       WHERE ta2.task_id = t.id
         AND ta2.stage_idx IS NOT NULL
         AND ta2.assignee_role NOT IN ('admin', 'client')
         AND (ta2.acceptance_status IS NULL OR ta2.acceptance_status != 'accepted')
     ))`,
  ));
}

// Employee task LIST (My Tickets): what they created, or are on and haven't declined
export function applyEmployeeTaskListScope(q: Knex.QueryBuilder, actor: Actor): Knex.QueryBuilder {
  q = q.where(function (this: any) { this.whereNot('t.status', 'pending_approval').orWhere('t.created_by', actor.id); });
  return q.whereRaw(
    `(t.created_by = ?
      OR (t.recurring_task_id IS NOT NULL AND t.assigned_to = ?)
      OR (t.crosspod_pods IS NULL AND t.crosspod_note IS NULL AND (
        t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ? AND COALESCE(skipped, 0) = 0 AND (acceptance_status IS NULL OR acceptance_status != 'declined'))
      )))`,
    [actor.id, actor.id, actor.id],
  );
}

// Can this person open a single task (drawer, comments, attachments, share link)?
// admin/manager: any task (their list endpoint is unscoped; team calendars open colleagues' tasks).
// employee: anything they are attached to — creator, assignee, stage person, reviewer, approver, or past actor.
// client: their projects' tasks, same as their list.
export async function canSeeTask(db: Knex, actor: Actor, taskId: number | string): Promise<boolean> {
  let q = applyDraftScope(db('tasks as t').leftJoin('projects as p', 't.project_id', 'p.id').where('t.id', taskId), actor);
  if (actor.role === 'admin' || actor.role === 'manager') {
    // no further scope
  } else if (actor.role === 'employee') {
    const me = actor.id;
    q = q.where(function (this: any) { this.whereNot('t.status', 'pending_approval').orWhere('t.created_by', me); })
      .where(function (this: any) {
        this.where('t.created_by', me).orWhere('t.assigned_to', me).orWhere('t.xlr8_assignee_id', me)
          .orWhereIn('t.id', db('task_assignees').where('user_id', me).select('task_id'))
          .orWhereIn('t.id', db('task_approval_flow').where('user_id', me).select('task_id'))
          .orWhereIn('t.id', db('approvals').where('submitted_by', me).select('task_id'))
          .orWhereIn('t.id', db('xlr8_ticket_log').where('actor_id', me).select('task_id'));
      });
  } else if (actor.role === 'client') {
    q = (await clientListScope(db, actor))(q);
  } else {
    return false;
  }
  return !!(await q.first('t.id'));
}

// 404 (not 403) so task / project ids can't be probed
export async function assertCanSeeTask(db: Knex, actor: Actor, taskId: number | string): Promise<void> {
  if (!(await canSeeTask(db, actor, taskId))) throw new ServiceError(404, 'Not found');
}

// A manager's Tasks page (pod tab): their pod's projects, work involving them or their pod's employees,
// and unpodded projects nobody from a pod is working on. Needs `t` and `p` joined.
export function applyManagerPodScope(q: Knex.QueryBuilder, pod: string, userId: number): Knex.QueryBuilder {
  return q.where(function (this: any) {
    this.where('p.pod', pod)
      .orWhere('t.created_by', userId)
      .orWhere('t.xlr8_assignee_id', userId)
      .orWhereIn('t.id', function (this: any) { this.select('task_id').from('task_assignees').where('user_id', userId); })
      .orWhereIn('t.id', function (this: any) {
        this.select('ta.task_id').from('task_assignees as ta').join('users as u', 'ta.user_id', 'u.id')
          .where('u.pod', pod).whereIn('ta.assignee_role', ['employee']);
      })
      .orWhere(function (this: any) {
        this.whereNull('p.pod').whereNotIn('t.id', function (this: any) {
          this.select('ta.task_id').from('task_assignees as ta').join('users as u', 'ta.user_id', 'u.id')
            .whereNotNull('u.pod').whereIn('ta.assignee_role', ['employee']);
        });
      });
  });
}

// Who may change / decide on a task (edit, delete, approve a request, assign stages, review, close).
// Seeing a task is wider than this: managers can open any pod's task but only act where the website gives
// them the buttons — their Tasks page scope, the projects in their list, unpodded projects (Approvals page),
// and tasks whose approval flow names them. Admins act on everything.
export async function canManageTask(db: Knex, actor: Actor, taskId: number | string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'manager') return false;
  const me = await db('users').where({ id: actor.id }).select('pod').first();
  if (!me?.pod) return !!(await db('tasks').where({ id: taskId }).first('id')); // pod-less manager: website shows all
  const q = applyDraftScope(db('tasks as t').leftJoin('projects as p', 't.project_id', 'p.id').where('t.id', taskId), actor)
    .where(function (this: any) {
      applyManagerPodScope(this, me.pod, actor.id)
        .orWhereNull('p.pod')
        .orWhereIn('t.project_id', db('project_members').where('user_id', actor.id).select('project_id'))
        .orWhereIn('t.id', db('task_approval_flow').where('user_id', actor.id).select('task_id'));
    });
  return !!(await q.first('t.id'));
}
export async function assertCanManageTask(db: Knex, actor: Actor, taskId: number | string): Promise<void> {
  await assertCanSeeTask(db, actor, taskId);
  if (!(await canManageTask(db, actor, taskId))) throw new ServiceError(403, 'Not your pod — this belongs to another pod manager');
}

// Doing the work: assigned, on a stage (not declined), or creator of a recurring instance
export async function isOnTask(db: Knex, userId: number, taskId: number | string): Promise<boolean> {
  const t = await db('tasks').where({ id: taskId }).select('assigned_to', 'xlr8_assignee_id').first();
  if (!t) return false;
  if (Number(t.assigned_to) === userId || Number(t.xlr8_assignee_id) === userId) return true;
  return !!(await db('task_assignees').where({ task_id: taskId, user_id: userId })
    .where((q: any) => q.whereNot('acceptance_status', 'declined').orWhereNull('acceptance_status')).first());
}

// ── Page permissions (S9) ──
// Server-side copy of the website's sidebar rule (Sidebar.tsx + utils/pageAccess.ts): admins see every page;
// managers/employees with saved permissions see exactly those; otherwise their role's default pages.
// SEO / Local SEO / Ads also need a matching category for employees, unless explicitly granted.
const ROLE_PAGES: Record<string, string[]> = {
  manager: ['/dashboard', '/projects', '/tasks', '/team-capacity', '/calendar', '/approvals', '/assets', '/messages', '/admin/users', '/seo', '/local-seo', '/ads', '/content', '/contact-forms', '/regularisation'],
  employee: ['/dashboard', '/tasks', '/calendar', '/approvals', '/assets', '/messages', '/seo', '/local-seo', '/ads', '/content', '/contact-forms'],
  client: ['/dashboard', '/projects', '/approvals', '/messages'],
};
const CATEGORY_GATE: Record<string, RegExp> = { '/seo': /seo/i, '/local-seo': /seo/i, '/ads': /ads/i };

export async function canUsePage(db: Knex, actor: Actor, page: string): Promise<boolean> {
  if (actor.role === 'admin') return true;
  const saved: string[] = await db('user_page_permissions').where({ user_id: actor.id }).pluck('page_slug');
  const pages = saved.length && actor.role !== 'client' ? saved : (ROLE_PAGES[actor.role] || []);
  if (!pages.includes(page)) return false;
  if (saved.includes(page) || actor.role !== 'employee' || !CATEGORY_GATE[page]) return true;
  const cats: string[] = await db('user_categories as uc').join('employee_categories as ec', 'uc.category_id', 'ec.id').where('uc.user_id', actor.id).pluck('ec.name');
  return cats.some((c) => CATEGORY_GATE[page].test(c));
}
export async function assertCanSeeProject(db: Knex, actor: Actor, projectId: number | string): Promise<void> {
  if (!(await canSeeProject(db, actor, projectId))) throw new ServiceError(404, 'Not found');
}
