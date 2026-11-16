# Assistant: MySQL and production readiness

Every item is labelled:

- **VERIFIED**: tested in this project's test suite (SQLite, one process).
- **ASSUMPTION**: believed correct from reading the code, not run.
- **UNTESTED**: no evidence either way.
- **GAP**: a known problem to fix before live use.

No production database was connected or changed.

## 1. SQLite versus MySQL

| Item | Status | Finding |
|---|---|---|
| Title search escape character | VERIFIED on SQLite, ASSUMPTION on MySQL | Was `ESCAPE '\'`, which MySQL reads as a broken string. Changed to `ESCAPE '!'`. |
| Time-tracking formula | ASSUMPTION | The MySQL branch uses `TIMESTAMPDIFF`; only the SQLite branch was exercised. |
| SEO and task-assignee schema changes | ASSUMPTION | MySQL and SQLite branches are both written; only SQLite was run. |
| Database connection pool | GAP | SQLite uses one connection; MySQL uses up to 10. See section 2. |
| Test suite | GAP | Tests use SQLite-only `CREATE TRIGGER` statements. A MySQL run needs a separate harness. |
| Unique indexes with NULL | ASSUMPTION | MySQL and SQLite both allow repeated NULLs in a unique index; the identity-link uniqueness relies on this. |

## 2. Transaction boundaries and nested transactions

| Item | Status | Finding |
|---|---|---|
| Ticket change plus audit row in one transaction | VERIFIED on SQLite | Rolls back together, including a forced audit failure. |
| Notifications and scheduling after commit | VERIFIED on SQLite | A rolled-back change sends nothing. |
| Nested transactions | VERIFIED on SQLite | `inTransaction` joins an open transaction instead of opening a second one. |
| Helpers that use the global connection inside a transaction | GAP | On SQLite this hangs, so it is blocked by the tests. On MySQL it would not hang but could read or write outside the transaction. The XLR8 `appendLog` path does this. Assistant actions do not reach XLR8, but this must be fixed before XLR8 is exposed. |
| Isolation level | ASSUMPTION | MySQL defaults to REPEATABLE READ. Read-then-write checks (for example "still pending") rely on conditional updates, which are safe under that level. |

## 3. Concurrent request processing and queue claims

| Item | Status | Finding |
|---|---|---|
| Single process, two claims | VERIFIED on SQLite | Two simultaneous runs complete one request only. |
| Claim atomicity across processes | GAP | `claimNext` reads a candidate, then updates it with a version check. The check prevents double-claims of one row, but nothing stops two workers claiming two requests for the same employee. The one-per-employee limit is checked, not enforced. |
| Lease and recovery | GAP | A claim has a lease, but no code renews it. A long action could be recovered while still running. |
| Worker loop | GAP | No worker starts in production. Execution is off, so nothing runs; this must exist before execution is enabled. |

## 4. Unique indexes and duplicate handling

| Item | Status | Finding |
|---|---|---|
| Inbound message dedupe | VERIFIED on SQLite | The same message ID twice creates one request. |
| Change dedupe per request and operation | VERIFIED on SQLite | A unique index on (request, operation) refuses a second change. |
| Duplicate-key detection | ASSUMPTION on MySQL | The code checks `ER_DUP_ENTRY` and the SQLite message. MySQL was not exercised. |
| Confirmation code uniqueness | ASSUMPTION | Codes are checked against open requests; not exercised under load. |

## 5. Migration and rollback safety

| Item | Status | Finding |
|---|---|---|
| Schema changes | ASSUMPTION | Changes are additive (`hasTable` / `hasColumn` checks). Safe to re-run. |
| Versioned migrations | GAP | No migration history or version table. Hard to know which changes ran in a given database. |
| Rollback | GAP | There are no down-migrations. Rolling back means restoring a backup. |
| Assistant tables | ASSUMPTION | New tables do not affect existing Loop tables. |

## 6. Server restart and recovery

| Item | Status | Finding |
|---|---|---|
| Recovery of interrupted requests | GAP | `recoverInterrupted` and `expireDue` exist and are tested, but **nothing calls them at startup or on a timer.** A request left mid-run stays stuck until someone acts. |
| Expiry of old requests | GAP | Expired requests are never executed (tested), but nothing marks them expired on a schedule. |
| Recovery of the website's own transitions | VERIFIED in code | The existing XLR8 transition recovery runs at startup. It does not cover assistant requests. |

## 7. Environment variable validation

| Item | Status | Finding |
|---|---|---|
| Assistant settings | VERIFIED | Invalid values are collected and reported as errors. |
| Invalid assistant settings at startup | GAP | The server catches the error and **silently treats the assistant as switched off**, with no log message. An operator could believe the assistant is on when it is not. Add a startup warning. |
| JWT secret | VERIFIED in code | Read from the environment; there is no built-in default. Requests fail if it is missing. |
| Demo accounts | VERIFIED | Random passwords. Written to the file named by `DEMO_CREDENTIALS_FILE` (mode 600) only when that is set; never logged and never written into the project by default. |

## 8. Secret management

| Item | Status | Finding |
|---|---|---|
| OpenAI key | VERIFIED | Environment only. The admin page shows Yes/No, never the value. Error text strips `sk-` keys. |
| Demo passwords | VERIFIED | The hard-coded `Admin@123` and the other demo passwords have been removed from the source (a test checks this). |
| Forced password change | GAP | Not implemented. A demo or initial account keeps its password until someone changes it. Needs a decision (see the final report). |
| Credentials in logs | VERIFIED | The seed no longer logs passwords. |
| Credentials in responses | VERIFIED | Admin API responses contain no keys, passwords or full phone numbers (browser and API checks). |

## 9. Logging and monitoring

| Item | Status | Finding |
|---|---|---|
| Request state history | VERIFIED | Every state change is recorded with its reason. |
| Failure reasons | VERIFIED | Stored without SQL or stack detail (`Internal error (details withheld)`). |
| Application logs | GAP | Plain `console` output only. No structured logs, no levels, no shipping. |
| Alerts | GAP | None. Admins must look at the Control Centre. |
| Metrics | GAP | None outside the admin dashboard counts. |

## 10. Database backup and restoration

| Item | Status | Finding |
|---|---|---|
| Backups | GAP | Not in this code. The operator must schedule them. |
| Restore test | UNTESTED | No restore has been rehearsed. A restore must be rehearsed before the pilot. |

## Summary of blockers before any live use

1. Wire startup recovery and request expiry, and add a worker that renews leases.
2. Enforce the one-request-per-employee limit atomically across workers.
3. Run the test suite against MySQL, or at least the transaction and queue tests.
4. Add a startup warning when assistant settings are invalid.
5. Decide and implement the forced password change for initial accounts.
6. Rehearse a restore from backup.

---

## Step 6.5 results (this implementation pass)

Status changes from the assessment above:

| Area | Before | Now | Evidence |
|---|---|---|---|
| Per-employee limit | Checked by the application only | **Enforced by the database**: a generated column (the employee's id while PROCESSING) with a unique index. Holds for direct SQL too. | SQLite reliability tests; MySQL M4, M5 |
| Lease renewal | Not renewed | Renewed every third of the lease while running; stops when the run ends | SQLite and MySQL tests (a run longer than its lease is not taken over) |
| Startup recovery | Not wired | Runs at startup when the assistant is on. Idempotent interrupted work is queued once more; work that is not safe to repeat is marked FAILED and never run | SQLite and MySQL restart tests |
| Expiry | Not scheduled | Runs on a background pass, and at startup | SQLite and MySQL expiry tests |
| Background worker | Not started | Started only when the assistant is on. Runs the executor only when the execution switch is on | Code review; startup check |
| Configuration | Invalid settings silently switched the assistant off | Invalid settings are listed by name at startup; the key is never printed | SQLite test; startup check (no secret in output) |
| First-login password | Demo passwords were known defaults | Random passwords; accounts must choose a new one at first login; every request is refused until they do | SQLite tests; browser-facing page built |
| MySQL schema | **Fresh MySQL install failed** (foreign keys between unsigned ids and signed columns) | Schema builds on a fresh MySQL database (60 tables) | MySQL smoke test |
| Global connection in transactions | Assistant paths reviewed | Assistant paths pass the transaction handle. The remaining global uses are in XLR8 and approval-workflow code, which the assistant cannot reach | Code review |

### SQLite results
- Full backend suite: 287 pass, 11 skipped (the MySQL harness runs only when enabled). Type check clean. Backend and frontend builds pass.

### MySQL results (isolated test server, port 3399, test database only)
- 11 of 11 pass: ticket change and audit atomicity; transaction rollback; duplicate protection; concurrent queue claims; per-employee limit under simultaneous claims; cross-pod approval; worker expiry; restart recovery; lease renewal; notification failure; uniqueness constraints.
- Run command (the harness refuses any other target):
  `DB_CLIENT=mysql NODE_ENV=development DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=loop_test DB_NAME=loop_assistant_test DB_PASS=<from private file> node --require ts-node/register --test src/assistant/mysql-harness.spec.ts`
- The harness empties its own test database before each run, and needs the server to allow trigger creation for the test user (`log_bin_trust_function_creators`), which is set on the isolated test server only.

### Remaining gaps (not closed by this pass)
1. **MySQL timestamps are whole seconds**, rounded. Lease and expiry checks are therefore accurate to about a second. Recovery now compensates for the retry time; other comparisons have not been audited.
2. **The existing SQLite-only test suites** (the older assistant specs with `CREATE TRIGGER` statements) have not been ported to MySQL. Only the harness runs on MySQL.
3. **The password-change page** has been built but not checked in a real browser in this pass.
4. **`backend/.env` is loaded at startup** and sets the database connection. Always set `NODE_ENV` explicitly when starting the server, and check which database a run will use. (The file's values were not read in this pass; only its setting names were listed.)
5. **Logging is still plain console output.** No structured logs, levels or alerts.
6. **Backups and restore** are not in the code and have not been rehearsed.
7. **Rollback of schema changes**: there are no down-migrations.
8. **`backend/seed-admin.ts`** still contains the old default password in the working tree. See GIT_HISTORY_REMEDIATION.md.


---

## Step 6.6 results (final security cleanup)

### Default credentials in source
- `backend/seed-admin.ts` no longer contains any password. It takes the initial password from `SEED_ADMIN_PASSWORD` (12+ characters), or generates one into a private file named by `SEED_CREDENTIALS_FILE` (mode 600). The account must choose a new password at first sign-in. Tested on a throwaway database: refusal when neither is set, refusal of a short password, generated file mode 600, the generated password verifies against the stored hash, a second run changes nothing, and no password appears in the output.
- A search of the working tree finds the old defaults only in the documentation and in one test that asserts they are gone.

### Password-change browser verification (isolated SQLite test database, real browser)
22 of 22 checks pass: a flagged account is redirected to the change page from every protected page; the API returns 403 with the code PASSWORD_CHANGE_REQUIRED; a wrong current password is refused and the user stays signed in; the 12-character minimum and the matching-confirmation rule are enforced in the browser; a successful change lands on the dashboard; the old password is refused; the new one works and clears the flag; a session opened before the change is ended; and no password appears in URLs, API responses, the browser console or the server log.

Two real bugs were found and fixed by this run:
1. The app's session check ran on every page load and deleted the token when the account was flagged, so the change page had nothing to send. The check now keeps the token on a 403, and a flagged account may read its own details.
2. A wrong current password returned 401, which the app treats as a lost session and sent the user to the login page. It now returns 400.

### SQLite and build results
- Backend suite: 287 pass, 11 skipped (the MySQL harness runs only when enabled). Type checks clean for backend and frontend. Backend and frontend production builds pass.
- The MySQL harness was not re-run: the changes in this step touch only the authentication middleware and the password endpoint, which the harness does not use. Its last result was 11 of 11.

### Production credential exposure (read-only, nothing connected)
- **Verifiable from local files:** the local environment file does not set production mode, and points the database at localhost. Production admin creation reads only `ADMIN_EMAIL` and `ADMIN_PASSWORD`, so the old default never applied there. The old demo seed ran only outside production.
- **Not verifiable here:** whether any real database was ever seeded from the old defaults. That can only be answered by reading that database's user table. Nothing was connected, and no password was changed. A read-only query by an operator should check for `admin@agency.com`, `admin@loooped.com`, and the demo manager, employee and client addresses, and whether those accounts still have `must_change_password` set.
- If any real environment used the defaults, rotation is required, and it needs separate approval.

### MySQL test environment cleanup
- The test MySQL server on port 3399 is no longer running, and its data folder and socket are no longer on disk. The dedicated test database therefore no longer exists on this machine. Nothing was dropped, and the existing local MySQL server (a separate process) was not touched.
- The scratchpad no longer contains several files that were present earlier in this project (including `copy.db`, `dist`, the Chrome profiles and some source backups). They were not removed by any step in this turn, and the cause is not known from here.

### Remaining production-readiness gaps
1. Rotation of any real environment that may have used the old defaults (needs approval).
2. Decision on rewriting Git history (needs approval and coordination with the clone holders listed in GIT_HISTORY_REMEDIATION.md).
3. Verification that the repository is private, which could not be checked here.
4. MySQL timestamp precision (whole seconds).
5. Older SQLite-only test suites, not ported to MySQL.
6. Structured logging and alerting.
7. Backup and restore rehearsal.
8. Down-migrations.
9. A MySQL run of the harness after the next change to shared code.
