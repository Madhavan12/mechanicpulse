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

## Feature: Job List

| # | Requirement source | Case | Expected result | Automated? |
|---|---|---|---|---|
| 1 | `docs/data-model.md` — every tenant row carries `workshop_id`, composite FKs block cross-workshop links | The list only ever returns jobs belonging to the authenticated mechanic's own workshop | A mechanic from workshop A never sees workshop B's jobs, even if IDs are guessable | ✅ `apps/api/src/routes/jobs.test.ts` — "only returns jobs for the authenticated mechanic's workshop" |
| 2 | Consistent with the existing auth pattern (`CLAUDE.md` — JWT + Fastify middleware) | The endpoint requires authentication | `401` with no/invalid token | ✅ `apps/api/src/routes/jobs.test.ts` — "requires authentication" |
| 3 | Added for this project — `job_status` (open/sent/decided/closed) has no "in progress" state, but the frontend spec needs one | A job with status `open` and no inspection items shows as **Not Started** | `displayStatus: "not_started"` | ✅ "maps an open job with no items to not_started" |
| 4 | same mapping | A job with status `open` and at least one inspection item shows as **In Progress** | `displayStatus: "in_progress"` | ✅ "maps an open job with items to in_progress" |
| 5 | same mapping | A job with status `sent`, `decided`, or `closed` shows as **Completed**, regardless of items | `displayStatus: "completed"` | ✅ "maps sent/decided/closed jobs to completed" (parameterized over all three) |
| 6 | `docs/mechanic-pulse-frontend-spec.md` — Job List bar shows "vehicle name + customer/bay" | Each job includes enough vehicle and customer info to render without a second request | Response item has `vehicleMake`, `vehicleModel`, `vehicleRego`, `customerName` | ✅ "includes vehicle and customer info on each job" |
| 7 | Edge case | A workshop with no jobs yet | Empty array, not an error | ✅ "returns an empty array when the workshop has no jobs" |
| 8 | Added for this project, not spec'd | Jobs are ordered newest-first | Most recently created job is first | ✅ "orders jobs newest first" |
| 9 | `docs/mechanic-pulse-frontend-spec.md` — Job List, desktop/mobile segmented control (All / Not Started / In Progress / Completed, or All / Active / Done on mobile) | Filtering by status works in the UI | Clicking a segment shows only matching jobs | 🔸 Manual only — filtering is done client-side over the full list for this iteration; no backend filter param |
| 10 | `docs/mechanic-pulse-frontend-spec.md` — "Create Job" button (added to the spec, not in the original Figma) | Button is present on the Job List page, meets the 44px minimum tap target (HIG-style touch target), and is visually distinct as the primary action | Button renders, is tappable, navigates toward job creation | ✅ `apps/web/e2e/create-job.spec.ts` — "creates a job from the Job List…" clicks the button and lands on `/jobs/new`. Tap-target size is 🔸 manual |
| 11 | Flagged by automated review, not from a written requirement | The page is titled "Today's Jobs (N)", but the query has no date filter — it returns every job the workshop has ever had | **Open question, not resolved**: does "today's" mean literally created today, or "currently open/active" regardless of date? Added a `LIMIT 200` as a safety cap against unbounded growth, but that's a mitigation, not an answer. Needs a product decision before real data makes this misleading. | ⬜ Not yet covered |

---

## Feature: Upload (photo capture → S3)

Full build-out (real Create Job integration, severity/price fields) still deferred per team discussion (2026-10-01). Two small additions made this week, logged here per the README rule rather than left undocumented:

| # | Requirement source | Case | Expected result | Automated? |
|---|---|---|---|---|
| 1 | Added for this project — interim wiring | ~~"+ New Job" opens `/capture`~~ — **superseded**: it now opens `/jobs/new` (see Create Job). `/capture` is still reachable by URL as the upload test page | n/a | n/a |
| 2 | Added for this project — "know how much compression was achieved", dev-facing only | After a successful upload, original size, compressed size, % saved, dimensions, and compress/upload timing are visible both in the browser console and on the page | Stats shown; green when the file got smaller, red when it got bigger (catches the iPhone-WebP-fallback-makes-it-bigger bug class from `docs/spike-results.md` again if it recurs) | 🔸 Manual only — no automated test; this is a dev-visibility aid, not a feature with a correctness requirement beyond "the arithmetic is right" |

---

## Feature: Create Job (`POST /api/jobs` + `/jobs/new`)

Written before the code, from the requirements in `docs/mechanic-pulse-frontend-spec.md` (Create Job) and `docs/data-model.md`. Verified 2026-11-02: the 11 e2e tests in `apps/web/e2e/create-job.spec.ts` pass in both mobile Chrome and mobile Safari (22 runs) against a real Postgres 16, along with the full e2e suite (74) and the API unit tests (127). The e2e specs need Postgres on port 5433 and a browser; see the README for how to run them.

| # | Requirement source | Case | Expected result | Automated? |
|---|---|---|---|---|
| 1 | CLAUDE.md — JWT middleware | Endpoint requires authentication | `401` with no/invalid token | ✅ `apps/api/src/routes/createJob.test.ts` — "requires authentication"; ✅ `apps/web/e2e/create-job.spec.ts` — "rejects an unauthenticated request" |
| 2 | Spec — required fields | Valid customer name, mobile, rego | `201` with the new job id; job is `open`, `created_by` = the caller, `workshop_id` = the caller's workshop (never taken from the body) | ✅ `apps/api/src/routes/createJob.test.ts` — "creates the job and returns its id", "takes workshop and mechanic from the token, never the body"; ✅ `apps/web/e2e/create-job.spec.ts` — "ignores a workshopId in the body" |
| 3 | Spec — required fields | Missing/blank name, mobile or rego | `400` naming the field; no DB write | ✅ `apps/api/src/lib/jobInput.test.ts` — "rejects …" (name, mobile, rego); ✅ `apps/api/src/routes/createJob.test.ts` — "rejects %s with a 400 naming the field, before touching the database" |
| 4 | data-model.md — phones are E.164 | Mobile typed as `0412 345 678`, `0412345678`, `+61412345678` | All stored as `+61412345678` | ✅ `apps/api/src/lib/jobInput.test.ts` — "accepts %s as +61412345678" (6 formats); ✅ `apps/api/src/routes/createJob.test.ts` — "stores the mobile as E.164 and the rego normalised" |
| 5 | data-model.md — phones are E.164 | Mobile that isn't a valid AU mobile (`12345`, landline, letters) | `400`; no DB write | ✅ `apps/api/src/lib/jobInput.test.ts` — "rejects %s" (short, landline, non-AU, letters, empty) |
| 6 | data-model.md — rego normalised, `^[A-Z0-9]{1,9}$` | Rego typed `abc 123` | Stored `ABC123` | ✅ `apps/api/src/lib/jobInput.test.ts` — "upper-cases and strips spaces"; ✅ `apps/api/src/routes/createJob.test.ts` — "stores the mobile as E.164 and the rego normalised" |
| 7 | same | Rego with punctuation, or over 9 characters | `400`; no DB write | ✅ `apps/api/src/lib/jobInput.test.ts` — "rejects %s" (punctuation, 10 chars, blank) |
| 8 | Spec — optional fields | Odometer negative, non-integer, or non-numeric | `400`; blank/absent is fine | ✅ `apps/api/src/lib/jobInput.test.ts` — negative, fractional, string odometer rejected; zero accepted; absent is fine |
| 9 | data-model.md — unique `(workshop, mobile)` | Customer with this mobile already exists in the workshop | Existing customer reused; no duplicate row | ✅ `apps/api/src/routes/createJob.test.ts` — "reuses an existing customer…", "does not overwrite an existing customer's name" (SQL shape); ✅ `apps/web/e2e/create-job.spec.ts` — "reuses the existing customer and vehicle and keeps the stored name" (real Postgres) |
| 10 | data-model.md — unique `(workshop, rego)` | Vehicle with this rego already exists in the workshop | Existing vehicle reused; no duplicate row; no unique-violation 500 | ✅ `apps/web/e2e/create-job.spec.ts` — "reuses the existing customer and vehicle…" (real Postgres); also covers a changed-hands car: "moves to the new owner; the old job keeps its customer" |
| 11 | CLAUDE.md — every tenant row carries `workshop_id` | Same mobile/rego exists in *another* workshop | Treated as new here; the other workshop's rows are untouched | ✅ `apps/web/e2e/create-job.spec.ts` — "another workshop's customer and vehicle are not touched or reused" |
| 12 | CLAUDE.md — `events` is the measurement layer | Successful create | One `job.created` event, actor `mechanic`, same transaction as the job | ✅ `apps/api/src/routes/createJob.test.ts` — "writes a job.created event in the same transaction"; ✅ `apps/web/e2e/create-job.spec.ts` — first test counts `job.created` events |
| 13 | Atomicity | Any step fails (e.g. job insert) | Rolled back — no orphan customer or vehicle | ✅ `apps/api/src/routes/createJob.test.ts` — "rolls back and releases the connection if a step fails"; ✅ `apps/web/e2e/create-job.spec.ts` — "a bad field returns 400 and leaves no orphan customer or vehicle" |
| 14 | Job List contract | New job appears in `GET /api/jobs` as **Not Started** | First in the list | ✅ `apps/web/e2e/create-job.spec.ts` — "the new job appears first in GET /api/jobs as not_started" |
| 15 | Spec — Create Job page | Form shows inline errors per field, server errors surface, button disabled while submitting (no double-create) | As described | ✅ `apps/web/e2e/create-job.spec.ts` — "shows inline errors and writes nothing…" (inline errors, no write). 🔸 Manual: layout and "button disabled while submitting" checked by Akash 2026-11-02 ✔; server field-error display (a 400 the client-side check misses) still unchecked |
| 16 | Spec — flow | "+ New Job" on `/jobs` opens `/jobs/new`; Cancel returns to `/jobs`; success lands on the new job (Job List until Active Job exists) | As described | ✅ `apps/web/e2e/create-job.spec.ts` — "creates a job from the Job List…", "Cancel goes back…", "sends a logged-out visitor to /login" |

| 17 | Decision 3 (2026-11-02) — don't silently rename a customer | Mobile matches an existing customer but the name typed differs | Stored name is kept; the job is attached to the existing customer | ✅ `apps/api/src/routes/createJob.test.ts` — "does not overwrite an existing customer's name" (SQL shape); ✅ `apps/web/e2e/create-job.spec.ts` — "reuses the existing customer and vehicle and keeps the stored name" |
| 18 | Decision 2 (2026-11-02) — `vehicles.customer_id` is the *current* owner | Rego matches an existing vehicle now with a different customer (car sold) | Vehicle moves to the new customer; the old job keeps its own `customer_id` | ✅ `apps/web/e2e/create-job.spec.ts` — "a car that changed hands moves to the new owner; the old job keeps its customer" |
| 19 | Added for this project — sane bounds | Name over 100 chars, make/model over 50, odometer over 9,999,999 | `400` naming the field; values exactly at the limit are accepted | ✅ `apps/api/src/lib/jobInput.test.ts` — "rejects %s" (4 limits) and "accepts values exactly at the limits" |
| 20 | Added for this project — optional text | Blank make/model | Stored as NULL, not an empty string; a blank on an existing vehicle does not wipe its stored make/model | ✅ `apps/api/src/lib/jobInput.test.ts` — "treats blank optional text as absent"; ✅ `apps/web/e2e/create-job.spec.ts` — "reuses the existing customer and vehicle…" asserts make stays `Toyota` |
