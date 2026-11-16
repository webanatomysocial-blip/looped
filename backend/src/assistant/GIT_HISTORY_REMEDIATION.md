# Git history: the old `Admin@123` default

Status: **found, documented, not changed.** No history was rewritten, nothing was force-pushed, and no credential was rotated in any real environment. Each of those needs your separate approval.

## What the history contains (read-only search)

The string `Admin@123` appears in four commits. All four are on `main` and on `origin/main` (remote `github.com/webanatomysocial-blip/looped`).

| Commit | Date | Subject | Files that contain it |
|---|---|---|---|
| `58c1cbda` | 2026-06-30 | first commit | `backend/src/db/index.ts`, `frontend/src/pages/Login.tsx`, `DEPLOYMENT.md`, `backend/dist/db/index.js`, `frontend/dist/assets/index-*.js` |
| `f07a7542` | 2026-07-03 | ready to go live | `DEPLOYMENT.md`, `backend/dist/db/index.js`, `frontend/dist/assets/index-*.js` |
| `d6dc7624` | 2026-07-29 | task changing v1.0.0.5 | `frontend/src/pages/Login.tsx` (and `Manager@123` also appears here, and in `f07a7542` and `58c1cbda`) |
| `03de764c` | 2026-08-31 | feat: stage flow tracker, search employees, split equally fix, validation, home canvas | `backend/seed-admin.ts` |

`Manager@123` appears in three commits (`58c1cbda`, `f07a7542`, `d6dc7624`).

**Current working tree (updated in Step 6.6):** `backend/seed-admin.ts` no longer contains any password literal. It now takes the initial password from `SEED_ADMIN_PASSWORD` (12+ characters), or generates one into a private file named by `SEED_CREDENTIALS_FILE`, and flags the account to change it at first sign-in. The old literal (`Admin@123` in the committed version, and a variant `Admin@1234` in `03de764c`) is still present in the four commits above.

**Build output:** `backend/dist` and `frontend/dist` were tracked in earlier commits (they contain the old default in compiled form). They are not tracked at HEAD now.

## Affected environments (from the code, not verified against any live system)

- **Anything seeded from the old demo list:** a database that was empty on first start received `admin@agency.com / Admin@123` (and the manager, employee and client defaults). This applies to any development or test database created from those commits.
- **Production:** the production path reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment, so it does not use the default. **Whether a production database was ever seeded with `Admin@123` cannot be determined from the repository.** Check the live user table, or treat the password as compromised if it was ever used.
- **The repository's visibility on GitHub** could not be checked here (the GitHub command-line tool is not installed). If the repository is public, the default has been exposed to anyone.

## Safe cleanup options (to decide; nothing done)

1. **Rotate, do not rely on history cleanup.** Anyone who has the repository (or a fork, or a clone) still has the old commits. Rotation is the only real fix for any environment that used the default.
2. **Remove the current copy.** Delete `backend/seed-admin.ts` (or replace its literal with a required environment variable). This is a normal commit and needs no history change.
3. **Rewrite history (optional, high impact).** Tools such as `git filter-repo` can remove the string from every commit. This changes every commit hash, breaks every existing clone and fork, and requires a force-push to `origin/main`. It also does not remove copies on other machines or in GitHub's caches. **Needs your explicit approval and coordination with everyone who has a clone.** Do this only in a separate mirror first, and verify with the same search before pushing.
4. **Make the repository private** (if it is public). Repository settings, not code.

## Confirmation

- No replacement plaintext password was added by this work. Demo accounts now receive random passwords (written only to a private file when `DEMO_CREDENTIALS_FILE` is set) and must change them at first login.
- `backend/.demo-credentials` is git-ignored.
- The GitHub remote (`origin/main`) contains the old values in the history listed above, and the last fetched `origin/main` head was `be7a15a8`.
- Authors in local history: 464 commits by `webanatomy`, 9 by `Dheerajreddy2109`, 3 by `Webanatomydev`, and 2 by `webanatomysocial-blip`. Those people hold clones and would need to re-clone after any history rewrite.
