# Loop AI Assistant: roadmap and scope

Status of this document: planning only. It changes no code and no behaviour.

## Scope decision

The immediate goal is to make Loop's existing **ticket management** work reliably through the AI Assistant. Everything else is deferred.

The assistant is a front end to Loop. Loop stays the single source of truth. It does not get its own ticket database, and it does not bypass Loop's ticket permissions or business rules.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Assistant foundation: message contracts, identity interface, provider abstraction | Complete |
| 2 | Employee identity: verified WhatsApp and simulator links | Complete |
| 2.5 | Security remediation and shared services for tasks, approvals and XLR8 | Complete at backend and API level. Browser checks outstanding (see below) |
| 3 | Understanding: intents, entities, clarification, confirmation prompts (`gpt-5.4-nano`) | Complete |
| 4 | Queue, confirmations, execution manager (no real handlers registered) | Complete |
| 4.5 | Admin Control Centre (admin-only read views, retry, identity revocation) | Backend complete. Frontend build, browser and layout checks outstanding (see below) |
| 5 | **Ticket integration** (ticket operations only, listed below) | **Not started. Awaiting approval** |

## Phase 4.5: outstanding verification (must clear before Phase 5)

1. Restore the frontend build on the development machine. The local `node_modules` is missing the macOS Rollup binary. Fixing it needs a dependency reinstall, which requires approval.
2. Run `npm run build` in `frontend/` and confirm the Control Centre bundles.
3. Check the Control Centre in a browser as an administrator: each tab, the filters, request details, retry and revoke confirmations, and the audit tabs.
4. Check the layout on a phone-width screen, and that the Admin Panel's existing pages are unchanged.
5. Check that an employee or manager cannot see the Control Centre page or its data.
6. Confirm the server environment for production: `ASSISTANT_AI_PROVIDER=openai` and `ASSISTANT_OPENAI_MODEL=gpt-5.4-nano`. The Configuration tab shows "none" until these are set.

## Phase 5: ticket integration (proposed scope, to be verified before work starts)

Phase 5 covers **tickets only**. The list below is what the project expects. Each operation must be checked against the existing ticket implementation before it is built. Do not assume an operation exists.

| Operation | Notes |
|---|---|
| Create ticket | Through the existing ticket creation rules, including approval routing for employees |
| View ticket | Only what the requester may already see in Loop |
| Search tickets | Scoped to the requester's existing visibility |
| Check ticket status | Current state and stage, in plain language |
| Assign ticket | Only where Loop's existing rules allow it for that requester |
| Update ticket details | Title, description, due date, priority, within existing permissions |
| Update ticket priority | Loop task priority, separate from assistant queue priority |
| Add comment | Visible to people who can already see the ticket |
| Accept or reject ticket | Only where the existing workflow supports it for that requester |
| Close ticket | Only where the existing workflow supports it |
| Retrieve permitted ticket history | Only the history Loop already shows that requester |

Every write goes through the confirmation flow from Phase 4 and the existing ticket services. Every action is audited.

## Explicitly deferred (not part of the current scope)

- XLR8 workflows, including multi-stage approvals and stage actions.
- Multi-stage workflow approvals of any kind.
- Sensitive project management operations.
- Project budgets and financial information.
- Reports and analytics.
- Attendance.
- General task management integration (anything beyond tickets).
- Other sensitive business information.

These may be planned separately later. They are not to be built as part of Phase 5.

## WhatsApp group privacy rules (apply to all phases)

The assistant is meant to work in a company WhatsApp group, so the following rules are binding:

1. Never assume every group participant can access every ticket.
2. Check the sender's verified identity (Phase 2) and their ticket-level permission on the backend, for every request.
3. Never disclose private ticket information to someone who is not authorised for that ticket.
4. Never disclose confidential project or business information in a group reply.
5. Never expose one employee's private ticket conversation to anyone else.
6. For sensitive requests, reply with a pointer to the private Loop application, not the answer.
7. Group replies contain only information that is safe for the whole group. Anything personal or ticket-specific goes privately or to the Loop app.
8. Enforce all of this on the backend. The AI prompt and the frontend are never the control.

## Standing requirements

- Loop remains the single source of truth. No parallel ticket database.
- Reuse existing ticket APIs and services. Do not duplicate business rules.
- Preserve employee identity verification (Phase 2).
- Preserve request confirmation and idempotency (Phase 4).
- Maintain the audit history for every action.
- Keep the model `gpt-5.4-nano` (`ASSISTANT_OPENAI_MODEL`). Do not change it.
- Keep the timezone `Asia/Kolkata`.
- Nothing is committed, pushed or deployed without explicit approval.

## Next step

Phase 5 does not start until the Phase 4.5 verification items above are complete and approved. The first Phase 5 task after that will be to inspect the existing ticket implementation and produce a verified list of operations, which will then be reviewed before any code is written.
