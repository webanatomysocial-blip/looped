# Access analysis & security checkpoint

Source of truth = what the **website** lets each role do. Each rule was read from both:
- **UI:** the frontend (`pages/Tasks.tsx`, `pages/Projects.tsx`, `components/UI/TaskViewDrawer.tsx`, `components/approvals/*`, `services/api.ts`);
- **API:** the backend routes.

Key: **UI** = what the website offers. **API** = what the server enforced before this checkpoint.

## 1. Role-by-role, module-by-module

### Projects
| Action | Admin | Manager | Employee | Client |
|---|---|---|---|---|
| List (Projects page) | All | Own pod + member projects | Member projects | Company + member projects |
| Pick a project when creating a task (`scope=all`) | All | All (cross-pod → approval) | All (cross-pod → approval) | — |
| See budget money | Yes | Yes (UI shows it) | **UI hides; API sent it** | **UI hides; API sent it** |
| Open one project `GET /:id`, `/members` | **Unused by the UI.** API was unscoped | ← | ← | ← |
| Create | Yes (pod manager must accept) | Yes (own pod auto-accepted) | — | — |
| Edit / delete | All | **UI: only projects in their list. API: any project** | — | — |
| Accept / decline pending project | — | **Notification goes to the pod manager. API: any manager** | — | — |
| Edit name / client / ad-hoc / non-employee members | Yes | UI locks these fields for managers; API allows | — | — |

### Tasks / tickets
| Action | Admin | Manager | Employee | Client |
|---|---|---|---|---|
| List | All (except other people's recurring instances); UI adds a pod filter | Same as admin; UI sends their pod | Created by them, or on it (not declined/skipped) | Company/member projects; tickets only once accepted |
| Open one task (drawer, approvals card, team calendar) | Any | Any (team calendar opens colleagues' tasks) | **UI: only from their list, approvals or calendar. API: any task** | **UI: own projects. API: any task** |
| Drafts | Creator only | Creator only | Creator only | — |
| Create | Yes → `todo` | Yes → `todo` | Yes → `pending_approval` (manager approves) | — |
| Edit (title, assignees, due date, priority…) | Edit button | Edit button | **No edit UI. API allows if assigned** (→ S6) | — |
| Delete | Yes | Yes | Own drafts only | — |
| Restore from Deleted | All | **UI lists own deletions + own pod. API: any row** | — | — |
| Approve/reject requests | Yes | Yes (cross-pod: the right pod) | — | — |
| Accept/decline, timer, checklist | n/a | own | Own assignment / current stage | — |
| Comment, attach link/file, share link | **Anyone who can open the drawer** | ← | ← | ← |
| Edit/delete a comment | Own only | Own only | Own only | Own only |
| Delete an attachment | Any | Any | Own | Own |
| Workload check when assigning | Yes | Yes | Yes (task form) | **API allowed; never in UI** |

### XLR8 tickets
- **Stage actions** (accept, done, review, approve, send to client) were already checked per stage and per role in `routes/xlr8.ts`.
- **Ticket detail** already scoped employees; **clients were unscoped**. The **ticket log was unscoped** for everyone.

## 2. Classification and what was done

| # | Finding | Class | Status |
|---|---|---|---|
| S1 | Task detail, comments, attachments, approval flow, mentionable, XLR8 ticket detail and log readable by anyone | **Vulnerability** | **Fixed** with `canSeeTask` → 404 |
| S2 | Comment / attach to any task | **Vulnerability** | **Fixed**: must be able to open the task. Clients can still comment on their own tasks, as on the website |
| S3 | Share link for any task | **Vulnerability**, but sharing a visible task is intended | **Fixed**: anyone who can open the task can share it (unchanged for real users) |
| S4 | Project detail and members unscoped; budgets sent to employees and clients (list and detail) | **Vulnerability** | **Fixed**: list scope reused, money stripped for employees and clients. Hours stay visible |
| S5 | Manager edits, deletes or accepts another pod's project | **Vulnerability** | **Fixed** with `canManageProject` (= projects in the manager's list) |
| S6 | Assigned employee can edit any field through the API | **Business-rule decision** | **Unchanged** (see §3) |
| S7 | Manager restores another pod's deleted ticket | **Vulnerability** | **Fixed**: same rule as the Deleted tab |
| S8 | Workload check | Intended for staff; **clients were a gap** | **Fixed** for clients only |
| — | Manager sees every task by ID, not just their pod's | **Intended** (list API is unscoped; team views rely on it) | Unchanged, but your call (§3) |
| — | Manager field locks are enforced in the UI only | **Business-rule decision** | Unchanged (§3) |
| S9 | Page permissions enforced in the UI only | **Business-rule decision**: enforcing them changes API access | Unchanged (§3) |
| S10 | 7-day JWT, no revocation | Hardening; logs everyone out once | Not done (§3) |
| S11 | No API rate limit outside auth | Hardening; needs tuning against UI polling | Not done (§3) |

Also fixed: on a **fresh** database, `initDB()` created `users` without `pod`, `monthly_salary`, `avatar_url` and `client_company_id`. Existing databases already have those columns.

## 3. Decisions needed (current → proposed → impact)

1. **S6, employee task edits.** *Current:* the website gives employees no edit button. Their changes go through accept/decline, timer and checklist only. The API, however, lets an assigned employee change the title, description, due date, priority, assignees and status (except completed/overdue). *Proposed:* match the website, so employees can't use `PUT /tasks/:id`, or can use it for description only. *Impact:* no website feature is lost. The assistant could not reassign or re-date tasks for employees. **Until you decide, the API behaviour stays as it is, for both channels.**
2. **Manager task scope.** *Current:* managers can open any task in any pod. *Proposed:* keep it, or limit it to own pod + tasks they're on. *Impact:* the second option may hide cross-pod tickets a manager reviews.
3. **Manager field locks.** *Current:* enforced in the UI only. *Proposed:* enforce on the server. *Impact:* none for the website.
4. **S9 page permissions.** *Proposed:* map each page to its API router (for example, `/seo` → `/api/seo`). *Impact:* users without a page grant lose that API.
5. **S10 token revocation** and **S11 global rate limit**: approve or defer.

## 4. Shared services (website and assistant use the same code)
- `services/access.ts`: `projectScope`, `canSeeProject`, `canManageProject`, `stripFinancials`, `clientTaskScope`, `applyEmployeeTaskListScope`, `applyDraftScope`, `canSeeTask`, `ServiceError`.
- `services/tasks.ts`: `listTasks`, `getTask`, `createTask`, `updateTask`, `pauseActiveSession`. Moved out of `routes/tasks.ts` unchanged.
- `services/projects.ts`: `listProjects`, `getProject`, `createProject`, `updateProject`. Moved out of `routes/projects.ts` unchanged.
- Routes are now thin wrappers. Role checks also live inside the services, so the assistant can't skip them by not going through a route.

Not moved yet: task accept, timer, comments, approvals, XLR8 stage actions, and project delete. They keep their own checks, which now call `access.ts`. The assistant shouldn't call any of them until they're moved.

## 5. Tests (`services/access.spec.ts`, 14 tests)
The tests use the real `initDB()` schema on in-memory SQLite, the real routers and real JWTs.

Roles: admin, pod1 manager, pod2 manager, member employee, unrelated employee, company-A client, company-B client.

Coverage:
- every fixed item, allowed and denied, by role;
- budget fields present or absent by role;
- a blocked upload writes nothing to disk;
- regressions for existing workflows: employee task request → manager approval, manager editing own-pod project, pod manager accepting a project, timer start/pause, client and employee list scope, the `scope=all` picker, restore, and S6 behaviour unchanged.

## 6. Phase 2.5 status (implemented)

| Item | Status |
|---|---|
| S6 employee task edits | **Implemented:** employees get 403 on `PUT /tasks/:id` (the website has no such screen). Accept/decline, timer, checklist, comments and attachments are unchanged. Description is not editable by employees anywhere on the website, so none is allowed. |
| Manager task visibility | **Kept:** managers still see any task. New `canManageTask` limits edit, delete, approve, stage assignment and close to their pod scope, the projects in their list, unpodded projects, or tasks whose approval flow names them. Viewing alone grants nothing. |
| Manager project locks | **Implemented:** name, ad-hoc setting and client are refused when changed; managers may change only employee memberships; admins and managers cannot be removed by a manager. |
| S9 page permissions | **Implemented for APIs that serve one page:** `/api/reports`, `/api/seo`, `/api/ads`, `/api/content`, `/api/contact-forms`, `/api/local-seo` now check the same rule as the sidebar (saved grant → role default → category gate). Not applied to shared APIs (tasks, projects, approvals, regularisation, capacity), because the dashboard uses them too. |
| S10 sessions | **Implemented:** every user has a session version. Password reset, admin password change, `POST /users/:id/revoke-sessions` and `POST /auth/logout-all` bump it, invalidating older tokens. Tokens issued before this change have version 0 and stay valid, so **no one is logged out at rollout**. The first revocation for a user logs that user out. |
| S11 rate limits | **Implemented:** per session (token hash), with IP only for anonymous calls. General API 1,500 requests / 5 min, writes 300 / 5 min, account and permission changes 30 / 15 min, public share links 300 / 5 min. |
| Approval scope (legacy approvals) | **Implemented:** managers can act on `PUT /approvals/:id` only for tasks in their scope. |
| Duplicate protection (XLR8) | **Implemented:** stage done, review and admin approval claim the ticket status atomically and roll back on failure. |
| Fresh-install schema | **Fixed:** `xlr8_ticket_types.checklist` was missing on new databases. |

Unresolved: the remaining route-level logic listed in `ASSISTANT_ACTIONS.md` (checklist, deliverables, legacy approvals). Regularisation and capacity page guards were not applied (shared with the dashboard).
