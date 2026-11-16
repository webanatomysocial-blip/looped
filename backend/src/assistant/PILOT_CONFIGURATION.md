# Assistant pilot configuration

Status: **pilot preparation only.** No employee is invited and no channel is connected. Execution is off.

## Fixed settings (do not change for the pilot)

| Setting | Value | Where it is set |
|---|---|---|
| AI provider | `ASSISTANT_AI_PROVIDER=openai` | environment |
| Model | `ASSISTANT_OPENAI_MODEL=gpt-5.4-nano` | environment (default in `config.ts`) |
| Timezone | `ASSISTANT_TIMEZONE=Asia/Kolkata` | environment (default in `config.ts`) |
| Execution switch | `ASSISTANT_EXECUTION_ENABLED=false` | environment, default `false` |
| Assistant on/off | `ASSISTANT_ENABLED=false` until a pilot is approved | environment, default `false` |
| Channels | `ASSISTANT_ADAPTERS=simulator` | environment, default `simulator` |

The API key is read from `OPENAI_API_KEY` (or `ASSISTANT_AI_API_KEY`). It is never shown in the admin Control Centre, which shows only "configured: Yes/No".

## Queue and timing (defaults)

| Setting | Default | Meaning |
|---|---|---|
| `ASSISTANT_CONFIRMATION_TTL_SECONDS` | 600 | A confirmation code is valid for 10 minutes |
| `ASSISTANT_CONTEXT_TTL_SECONDS` | 1800 | An unfinished request expires after 30 minutes without a reply |
| `ASSISTANT_QUEUE_EXPIRY_SECONDS` | 900 | A confirmed request that has not started within 15 minutes expires |
| `ASSISTANT_QUEUE_MAX_ATTEMPTS` | 3 | Transient failures are retried up to 3 attempts in total |
| `ASSISTANT_QUEUE_LEASE_SECONDS` | 120 | A worker's claim on a request lasts 2 minutes before another may recover it |
| `ASSISTANT_MAX_CONCURRENT_PER_USER` | 1 | One running request per employee at a time |
| `ASSISTANT_AI_TIMEOUT_MS` | 20000 | Model call timeout |

## Identity links

- **Simulator:** the sender must be a staff member with an **active** simulator link. A revoked, deleted or unlinked employee is refused at intake, before any request is saved. Clients are never staff identities and are always refused.
- **WhatsApp (not in this pilot):** a phone number maps to one active link per employee. Replacing a link revokes the old one.
- Every refusal gets the same plain reply: "I can't act on this yet: your account isn't linked to Loop." It names no employee and shows no ID.
- Links are created and revoked by an administrator. The admin Control Centre shows the employee's name, role and channel. Phone numbers are masked, and in-app (simulator) links show no number.

## Supported ticket operations (pilot scope)

Allowed through the assistant, and each one goes through the existing Loop services:

1. Create a plain ticket (project, assignee, optional deadline and priority).
2. Assign or reassign a plain ticket.
3. Change priority.
4. Change permitted details: title, description, due date.
5. Add a comment.
6. Accept an assignment (the assignee only).
7. Approve or reject a pending request (managers only, within their scope).
8. Search and view tickets (read only).

**Not available:** decline, completing or closing tickets, comment edit and delete, XLR8 workflow tickets, timers, checklists, and any other intent. These are refused with a plain message and no request is saved.

## Existing Loop permission enforcement

The assistant decides nothing about permissions. Every action calls the same service the website uses (`services/access.ts`, `tasks.ts`, `taskWorkflow.ts`, `comments.ts`). That means:

- Employees see only tickets they created, are assigned to, or are otherwise involved in. Drafts are visible only to their creator.
- Employees cannot edit tickets, approve, or assign.
- Managers act only within their pod scope. A pod's manager can decide a cross-pod hold when their pod is listed as waiting.
- Admins can do everything the website allows.
- An unseen ticket gives the same answer as a ticket that does not exist.

## Cross-pod approval rules

- Creating or reassigning to a person from another pod, or onto a project in another pod, puts the ticket on hold (`pending_approval`) until each required pod's manager approves.
- The rule is the same one the website uses: `approvalReasons`, with the project and the assignee. Admins are exempt.
- A reassignment on hold does not change the assignee. It applies only after every required pod approves. One rejection stops it, and the ticket returns to its previous status.
- While on hold, the ticket cannot be started, resumed or finished. Pausing still works, and any running clock is stopped and its time logged.

## Confirmation requirements

- Nothing changes until the employee replies with the confirmation code (`CONFIRM <code>`).
- A code is valid for the confirmation window only. A request can be cancelled with `CANCEL <code>`.
- Ticket references must match exactly one ticket the employee can see. Zero or several matches produce a question, not a guess.

## Request expiry and retry behaviour

- **Expired** requests (unfinished or unconfirmed) are never executed.
- **Cancelled** requests are never executed.
- **Transient failures** (for example a database timeout) are retried with backoff, up to 3 attempts in total.
- **Refusals by Loop's own rules** (for example "not your pod") end the request at once, and are not retried.
- **Retries never repeat a change.** Every change is recorded under its request ID; a second attempt returns "already done".
- **Failed** requests are visible to admins, who can retry them from the Failures tab.

## Group-chat restrictions

- Ticket changes are made only from private channels. A group sees only the fixed reply: "For ticket details, please open the Loop app. I can't share ticket information in this chat."
- Group messages cannot create, change or read tickets, and nothing is saved from them.

## Admin monitoring and recovery

| Task | Where | What to watch |
|---|---|---|
| See today's activity | Overview | Request counts by status |
| Watch live work | Live queue | Requests waiting or running; anything stuck in "processing" for longer than the lease |
| Investigate a request | Requests (filter by status, employee, intent) | Status history and the masked failure reason |
| Failed requests | Failures | Failure reason; use **Retry** only when the reason is transient |
| Revoke access | Identities | Revoke immediately when an employee leaves or a device is lost |
| Read conversations | Conversations | Only for support; each employee's conversations are separate |
| Audit trail | Audit | Request events, and administrative actions (retry, revocation) |
| Check settings | Configuration | Model, timezone, execution state, queue settings, key shown as Yes/No only |

**Recovery:** a failed request is retried only from the Failures tab, and only when its error is transient. A refused request should be left alone. If a worker stops mid-request, its lease expires and the request must be recovered; see PRODUCTION_READINESS.md for the gap in automatic recovery.

## Added in Step 6.5

- **First login:** seeded accounts must choose a new password before anything else. Every request is refused with "Choose a new password before continuing" until they do. Changing the password signs out other sessions.
- **Background worker:** runs only when the assistant is on. It expires old requests, recovers interrupted work at startup, and runs the executor only when `ASSISTANT_EXECUTION_ENABLED=true`.
- **Per-employee limit:** one running request per employee, enforced by the database.
- **Startup checks:** invalid assistant settings are listed by name at startup, and the assistant stays off.
