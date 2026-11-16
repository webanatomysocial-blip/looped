# Loop AI Assistant

Status: **Phase 2 (identity) complete.**
- `/api/assistant/*` returns 404 unless `ASSISTANT_ENABLED=true`.
- No WhatsApp connection and no live AI calls.
- Two tables are created at startup: `assistant_identities` and `assistant_link_codes`.

Run tests: `cd backend && npm test`. See [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md); that checkpoint must be completed before Phase 3.

## Identity linking (Phase 2)

| File | Responsibility |
|------|----------------|
| `identityStore.ts` | Schema, sender-ID normalisation, link codes, verification, activate / deactivate / revoke, `DbIdentityResolver`, `SimulatorIdentityResolver`, `ChannelIdentityResolver`, and `createLinkHandler` (the pipeline hook) |
| `routes.ts` | `/api/assistant/identity/*` (self-service and admin) |

How an employee links a number. No outbound OTP delivery is needed.
1. The employee is logged in on Loop. They re-enter their password, then `POST /api/assistant/identity/me/link-code {channel:'whatsapp', phone:'+91…', current_password}`. They receive an 8-character code, valid for 15 minutes.
2. From that phone, they send `LINK ABCD-EFGH` to the assistant.
3. The code is only accepted when the channel reports that exact number as the sender:
   - It's single-use, and only the newest code works.
   - After 5 wrong codes, the code is burned.
   - It's stored as a hash.
4. The mapping becomes active, and the user gets a Loop notification about it.

Admin-assisted: `POST /api/assistant/identity/link-code {user_id, channel, phone}` issues the code for the employee. Step 2 still has to come from the employee's phone. Admins can also list, deactivate, activate and revoke any mapping.

Rules:
- Only one active mapping per number, and one per user per channel. Unique keys enforce this in the database itself.
- Linking a new number retires the old one.
- A revoked mapping can never be reactivated; the number has to be verified again.
- The user's row and current role are read on every message. A deleted user, or one who is now a client, stops resolving immediately.
- The mapping only says *who* the sender is. Permissions always come from the user's current Loop role.
- Simulator senders are `loop-user:<id>`. Only the server may set that value, from the logged-in session; it's never accepted from the browser.

## Modules

| File | Responsibility |
|------|----------------|
| `types.ts` | Channel-independent contracts: `IncomingMessage`, `OutgoingResponse` + validators; request/conversation model (`AssistantRequest`, `ActionStep`, `AuditEvent`); `conversationKey()` |
| `config.ts` | Reads `ASSISTANT_*` env vars, validates them, `describeConfig()` redacts the key |
| `identity.ts` | `IdentityResolver` interface. `DenyAllIdentityResolver` is the default; `StaticIdentityResolver` is for tests/simulator only |
| `adapters.ts` | `ChannelAdapter` interface + `SimulatorAdapter` (in-memory outbox). WhatsApp adapter is Phase 2+ |
| `ai.ts` | `AIProvider` interface, `AIError` codes, `UsageRecorder`, `MockAIProvider`, provider factory, closed intent list, JSON parsing/sanitising, `IntentClassifier` / `EntityExtractor` interfaces |
| `pipeline.ts` | 12-stage pipeline with injected `RequestStore`, `AuditLog`, `PermissionChecker`, `ActionExecutor`. Phase 1 runs stages 1–4 and 11–12, then stops with `actions_not_enabled` |

Dependency rule (enforced by a test): `pipeline.ts`, `types.ts` and `identity.ts` never import adapters or AI SDKs.

```
 channel payload ──► ChannelAdapter.toIncoming ──► IncomingMessage
                                                      │
   processMessage: validate → dedupe(messageId) → IdentityResolver(channel, senderId)
                   → conversationKey(channel, group, loopUserId) → IntentClassifier(AIProvider)
                   → [Phase 3+: entities → validate → PermissionChecker → plan → confirm
                      → ActionExecutor (existing Loop services, as the verified user)]
                   → RequestStore + AuditLog → OutgoingResponse ──► ChannelAdapter.send
```

## Configuration (all optional; everything off by default)

| Variable | Default | Notes |
|----------|---------|-------|
| `ASSISTANT_ENABLED` | `false` | Master switch |
| `ASSISTANT_SIMULATOR_ENABLED` | `false` | In-app chat simulator |
| `ASSISTANT_ADAPTERS` | `simulator` | Comma list: `simulator`, `whatsapp` |
| `ASSISTANT_AI_PROVIDER` | `none` | `none` \| `mock` \| `openai` \| `anthropic` \| `gemini` |
| `ASSISTANT_AI_MODEL` | — | Required for real providers when enabled |
| `ASSISTANT_AI_API_KEY` | — | Required for real providers when enabled. Server-only |
| `ASSISTANT_AI_TIMEOUT_MS` | `20000` | |
| `ASSISTANT_AI_MAX_OUTPUT_TOKENS` | `1024` | |
| `ASSISTANT_LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `ASSISTANT_CONFIRMATION_TTL_SECONDS` | `600` | |
| `ASSISTANT_MAX_CONCURRENT_PER_USER` | `1` | For the Phase 4 queue |

## Proposed data model (not created yet — Phase 2/4, additive only)

Following the existing `hasTable → createTable` convention in `db/index.ts`.

- `assistant_identities` (Phase 2): `id`, `channel`, `external_sender_id`, `user_id → users.id`, `verified_at`, `verified_by`, `revoked_at`. Unique (`channel`, `external_sender_id`).
- `assistant_conversations`: `id`, `conversation_key` (unique: channel+group+user), `channel`, `external_conversation_id`, `user_id`, `state` (JSON), `expires_at`, timestamps.
- `assistant_requests`: `id` (uuid), `conversation_id`, `user_id`, `channel`, `external_conversation_id`, `external_message_id`, `intent`, `entities` (JSON), `priority` (`interactive|normal|background`, unrelated to `tasks.priority`), `status`, `confirmation_status`, `error`, timestamps. **Unique (`channel`, `external_message_id`)** gives atomic duplicate protection.
- `assistant_request_actions`: one row per backend action (`request_id`, `seq`, `action`, `params` JSON, `status`, `result` JSON, `error`). One request can create several actions.
- `assistant_audit_log`: append-only (`request_id`, `stage`, `detail`, `created_at`).

## Security findings in existing code that matter for the assistant

These are verified in source. They're **not fixed in Phase 1**. The assistant must not call any of these paths until each one has a server-side check.

1. `GET /api/tasks/:id`, `/:id/comments`, `/:id/deliverables`, `/:id/approval-flow`, `/:id/mentionable` (`routes/tasks.ts`): no project-membership or role scoping. Any logged-in user, **including clients**, can read any task by id.
2. `POST /api/tasks/:id/comments` and `/:id/deliverables/*`: any user can write to any task.
3. `POST /api/tasks/:id/share-token`: any user can mint a public link for any task.
4. `GET /api/projects/:id` and `/:id/members` (`routes/projects.ts`): no scoping. Budget fields (`budget_amount`, `budget_cutoff_pct`) are returned to any role, including clients.
5. `PUT` and `DELETE /api/projects/:id`: managers can edit or delete **any** project, not just their pod's.
6. `PUT /api/tasks/:id`: managers and admins are not pod-scoped. An employee assigned to a task can change its title, assignees and due date.
7. `GET /api/capacity/check/:userId`: no role guard on another user's workload.
8. Page permissions (`user_page_permissions`) are enforced only in the frontend.
9. JWTs last 7 days with no revocation. There's no rate limit outside `/api/auth`.
10. Business logic lives inside route handlers, not services. In Phase 3, the executor has to either call the HTTP routes as the user or extract the logic into shared services. It can't call `db(...)` directly.

## Roadmap and scope

See [ROADMAP.md](ROADMAP.md). Current scope is ticket operations only; Phase 5 waits for approval, and the Phase 4.5 verification items must be completed first.
