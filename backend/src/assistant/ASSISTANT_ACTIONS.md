# Assistant ticket actions: readiness (Phase 2.5 final)

Scope: tickets and tasks and their existing workflows only.

- **READY** — shared service exists, the permission rule is enforced in the service, and tests cover it.
- **NOT READY** — missing service, validation or tests. Do not expose.
- **DEFERRED** — outside the initial ticket-only scope. Do not expose.

"Confirm" = the assistant must show a summary and get an explicit yes first (policy for Phase 3+).

| Action | Status | Who may perform it | Service | Tests | Confirm |
|---|---|---|---|---|---|
| View my tasks | READY | Staff; clients see their projects | `services/tasks.listTasks` | access.spec | No |
| View task status | READY | Anyone who can see the task | `services/tasks.getTask` | access.spec | No |
| View ticket status / stage | READY | Anyone who can see the ticket (employees only if on it) | `services/xlr8.getTicket` | workflow.spec | No |
| Create task | READY | Admin, manager (→ todo); employee (→ pending approval) | `services/tasks.createTask` | access.spec, workflow.spec | Yes |
| Create ticket | READY | Admin, manager, employee | `services/xlr8.createTicket` | workflow.spec | Yes |
| Pod-manager approve / reject request | READY | Admin; manager in pod scope (`canManageTask`) | `services/taskWorkflow.managerApproveTask` | workflow.spec | Yes |
| Accept assigned task | READY | Assignee only; idempotent | `services/taskWorkflow.acceptTask` | workflow.spec | No |
| Decline assigned task | NOT READY | Assignee only | `services/taskWorkflow.acceptTask` (decline branch) | no test yet | Yes |
| Accept stage (XLR8) | READY | Stage person; all stage people must accept before start | `services/xlr8.preAcceptStage` / `acceptCurrentStage` | workflow.spec | No |
| Decline stage (XLR8) | READY | Stage person; once per stage; manager reassigns | `services/xlr8.preDeclineStage` / `declineCurrentStage` | ticket-decisions.spec; HTTP walk | Yes |
| Timer start / pause | READY | Current worker / assignee | `services/taskWorkflow.timerAction` | workflow.spec | No |
| Timer finish | NOT READY | Current worker / assignee | `services/taskWorkflow.timerAction` (done) | only the refusal (open checklist) is tested | Yes |
| Stage completion (XLR8 "done") | READY | Current stage person; checklist complete | `services/xlr8.markStageDone` | workflow.spec | Yes |
| Manager review approve / send back | READY | Manager in pod scope; designated employee reviewer | `services/xlr8.reviewTicket` | workflow.spec | Yes |
| Final admin approve / decline / send to client | READY | Admin only | `services/xlr8.adminApproveTicket` / `adminDeclineTicket` / `adminSendToClient` | ticket-decisions.spec; HTTP walk | Yes |
| Client approve / reject | READY | Client of the project's company | `services/xlr8.clientApproveTicket` / `clientRejectTicket` | ticket-decisions.spec; HTTP walk | Yes |
| Close without client sign-off | READY | Manager in scope or admin | `services/xlr8.closeTicket` | ticket-decisions.spec | Yes |
| Assign / reassign stage (XLR8) | READY | Manager in pod scope | `services/xlr8.updateStageAssignments` / `assignTicket` / `startAssignment` | workflow.spec (indirect) | Yes |
| Add comment | READY | Anyone who can see the task | `services/comments.addComment` | workflow.spec | No |
| Edit / delete own comment | READY | Author only | `services/comments.updateComment` / `deleteComment` | workflow.spec (edit) | Delete: yes |
| Tick checklist item | READY | Admin/manager (any visible); otherwise the stage or task assignee | `services/checklist.setChecklistItem` | extraction.spec | No |
| Attach link | READY | Anyone who can see the task; http/https only | `services/deliverables.addDeliverableLink` | extraction.spec | Yes |
| Attach file (upload) | DEFERRED | Upload needs multer and a file from the employee; not possible from a chat message yet | route (multer) + `addDeliverableFile` | extraction.spec (delete path) | — |
| Remove attachment | READY | Uploader, or admin/manager | `services/deliverables.deleteDeliverable` | extraction.spec | Yes |
| Legacy approval review (approve/reject) | READY | Role and pod scoped (manager pod scope) | `services/approvals.reviewApproval` (legacy branch) | extraction.spec | Yes |
| Custom-flow approval review | READY | Named approver, in order; only while pending | `services/approvals.reviewApproval` (custom branch) | ticket-decisions.spec (fixed: decided approvals can no longer be decided again) | Yes |
| Submit work for legacy review | READY | Assignee or admin/manager | `services/approvals.completeWork` | extraction.spec | Yes |
| Submit a new approval request | NOT READY | Creator | route `POST /approvals` (not extracted) | none | Yes |
| Assign / delete a task | READY | Manager in pod scope; employee only own drafts | `services/tasks.updateTask`, `services/taskWorkflow.deleteTask` | access.spec, workflow.spec | Yes |
| Delete ticket types, project admin tools | DEFERRED | Admin only; not ticket workflow | — | — | — |
| Budgets, reports, attendance, leave | DEFERRED | Out of initial scope | — | — | — |

## Not ready — reasons

- **Decline assigned task** and **timer finish** — the happy path and the decline path lack tests.
- **Submit a new approval request** — still in the route file (not extracted, not tested).

## Rules every action follows

- The assistant acts as the verified employee. It never creates tokens and never writes to tables directly.
- Resources outside a person's view return 404, not 403, so ids cannot be probed. Visible-but-not-permitted returns 403.
- Duplicate protection: XLR8 transitions claim the ticket atomically; a repeat after success fails (404/409) and changes nothing. Plain-task acceptance is idempotent. A crash mid-transition is restored at startup (`recoverInterruptedTransitions`), so the step can be retried.
