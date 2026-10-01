# MechanicPulse — Test Cases

One section per feature. Each section lists test cases derived from the actual requirements (CLAUDE.md, product-decisions.md, data-model.md, the frontend spec) — not reverse-engineered from the code — then says whether each case is covered by an automated test, and where.

**Rule (see README ground rules): this doc must be updated in the same PR as the development it describes** — new feature, new case; changed behavior, updated case; case now automated, updated status.

Format per feature:

```
## Feature: <name>

| # | Requirement source | Case | Expected result | Automated? |
|---|---|---|---|---|
```

`Automated?` is one of:
- ✅ `path/to/file.test.ts` — "test name" — covered by an automated test
- 🔸 Manual only — needs a human/click-through check, not yet automated (and says why, if it's a real blocker like needing a browser or a real Postgres)
- ⬜ Not yet covered — a known gap

---

## Feature: Login

| # | Requirement source | Case | Expected result | Automated? |
|---|---|---|---|---|
| 1a | `docs/data-model.md` — `email citext NOT NULL UNIQUE`, "login is global, not per workshop" | Login looks up the mechanic by email alone | The query is not scoped by `workshop_id` | ✅ `apps/api/src/routes/auth.test.ts` — "looks up the mechanic by email alone, with no workshop in the request" |
| 1b | same as above — `citext` type | Email matching is case-insensitive (`Owner@Demo.test` logs in the same as `owner@demo.test`) | Login succeeds regardless of case | ⬜ Not yet covered — this is enforced by the Postgres column type, not application code, so a test that mocks `db.query` can't verify it. Needs an integration test against a real Postgres. |
| 2 | `docs/data-model.md` — `password_hash ... CHECK (password_hash LIKE '$2%')` | Any password written to the DB is a bcrypt hash | A plaintext or non-bcrypt hash must never be persisted | ⬜ Not yet covered — this is a write-path (account creation/provisioning) constraint, not something login itself can test. Revisit once provisioning exists. |
| 3 | `docs/data-model.md` — `is_active boolean DEFAULT true` | An inactive mechanic cannot log in, even with the correct password | `401`, same generic error as a wrong password | ✅ `apps/api/src/routes/auth.test.ts` — "rejects a correct password for an inactive mechanic" |
| 4 | `docs/data-model.md` — `last_login_at timestamptz` | A successful login updates this field | `mechanics.last_login_at` is set | ✅ `apps/api/src/routes/auth.test.ts` — "updates last_login_at on a successful login" |
| 5 | `docs/data-model.md` — `role mechanic_role ('owner'|'mechanic')` | Login returns the mechanic's role | Response includes `mechanic.role` | ✅ `apps/api/src/routes/auth.test.ts` — "returns the mechanic's role in the response" |
| 6 | `CLAUDE.md` / `docs/product-decisions.md` — "bcrypt hash + JWT session token" | A successful login returns a JWT, not a cookie or server-side session | Response has a `token` field; no `Set-Cookie` header | ✅ `apps/api/src/routes/auth.test.ts` — "returns a JWT and sets no session cookie" |
| 7 | `CLAUDE.md` — "NOT phone/OTP. NOT Keycloak." | Login succeeds with only email + password — no OTP step, no redirect to a third-party identity provider | `200` with just those two fields | ✅ `apps/api/src/routes/auth.test.ts` — "logs in with only email and password, no OTP or external-provider fields required" |
| 8 | `docs/product-decisions.md` — "No self-signup... team creates each workshop's account directly" | There is no reachable signup/register endpoint | `POST /api/auth/signup` and `/api/auth/register` both 404 | ✅ `apps/api/src/routes/auth.test.ts` — "has no signup/register endpoint" |
| 9 | `docs/mechanic-pulse-frontend-spec.md` — Login, desktop | At desktop width (≥1280px / `lg`), the form appears in a 400px centered card | Visually distinct card, centered both axes | 🔸 Manual only — needs a real browser at a given viewport width; no component test written yet |
| 10 | same, mobile | At mobile width (390px), there is no card — fields sit flush, top-aligned with generous top padding, not vertically centered | No card chrome at `<lg` | 🔸 Manual only |
| 11 | same — "Email field, Password field (44px input height, label above)" | Both inputs are 44px tall with a visible label above each | `TextField` renders at `h-11` (44px) with a `<label>` | 🔸 Manual only — visually correct per code review of `components/TextField.tsx`, not yet asserted by an automated test |
| 12 | same — "Forgot password? link" | The link is visible on the screen | Present in the DOM | 🔸 Manual only |
| 13 | same — "full-width primary Log In button" | The submit button spans the full width of the form | `Button` rendered with `fullWidth` | 🔸 Manual only |
| 14 | same — "Action: Log In → navigates to Job List" | Successful login navigates away from `/login` | Currently navigates to `/capture`, not Job List (Job List doesn't exist yet — known, flagged gap, see `login/page.tsx` comment) | 🔸 Manual only |
| 15 | Added for this project, not from a written doc — general security practice | A wrong password and a non-existent email produce the same response | Same status code, same body for both | ✅ `apps/api/src/routes/auth.test.ts` — "gives the same error and status for a wrong password and a nonexistent email" |
| 16 | Added for this project, not from a written doc | The password hash never appears in the login response | Response body never contains `password_hash` or the hash value | ✅ `apps/api/src/routes/auth.test.ts` — "never includes password_hash anywhere in the response" |
| 17 | Added for this project, not from a written doc | Malformed/missing input fails cleanly, doesn't crash the server | `400` for missing email, missing password, or empty-string email (no DB query fired); a non-5xx for malformed JSON | ✅ `apps/api/src/routes/auth.test.ts` — "returns 400 for missing email", "returns 400 for missing password", "returns 400 for an empty-string email rather than querying the database", "does not crash on a malformed JSON body" |

**Coverage summary:** 9 of 17 cases automated (backend, unit-level, mocked DB). The remaining 8 are either frontend/visual (need a component or E2E test, not written yet) or DB-constraint-level (need an integration test against real Postgres, not written yet).

---

## Feature: Upload (photo capture → S3)

Deferred — out of scope for the current iteration per team discussion (2026-10-01). This section is a placeholder so the structure exists; fill in requirement-derived cases and automated coverage when upload is revisited.
