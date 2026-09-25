# MechanicPulse — Decision Log

Full reasoning behind every major call, so nobody (human or Claude Code) re-litigates a decision without knowing why it was made. Referenced from `CLAUDE.md`.

---

## Frontend framework: Next.js (React), browser-only

**Chosen:** Next.js, running in the browser, no native wrapper, for both the mechanic app and the customer report page.

**Rejected:** Capacitor-wrapped native app; full React Native rewrite.

**Why:** The near-term goal (by ~22 Nov 2026) is a working proof of concept to validate the idea and support investor conversations — not an App Store launch. A plain browser app removes install friction (no TestFlight invite, no App Store download) from a phase meant to test whether mechanics find the core idea useful, not whether app installation goes smoothly. It's also simply less work — no Capacitor setup, no native camera plugin, no developer account fees — for a phase where none of that changes what's being validated.

**This is not a closed door.** Capacitor wraps the *built output* of the same Next.js/React code, not the source, so this isn't a rewrite-later situation. If the PoC succeeds and the team moves toward wider distribution (post-funding, scaling past hand-picked pilots), Capacitor can be added on top of the same codebase — realistically hours to a day of work, mainly swapping the browser camera API for Capacitor's native camera plugin. React Native was considered and rejected even for that future scenario, since it would mean writing the mechanic UI a second time in a separate framework.

---

## Backend framework: Node.js / Fastify

**Chosen:** Fastify.
**Rejected:** Python (FastAPI).

**Why:** Matches Madhavan's already-working presign spike (Node/Express-style). One language across frontend and backend cuts context-switching for a 2-person dev team and lets either of us read the other's code. Fastify over Express specifically for built-in schema validation and lower overhead.

---

## Database: PostgreSQL on RDS

**Chosen:** PostgreSQL.
**Rejected:** DynamoDB.

**Why:** The data is inherently relational — workshops, jobs, line items, approvals, all with real foreign-key relationships. Madhavan's SQL background makes this the path of least resistance. Twenty pilot workshops is nowhere near DynamoDB's scaling sweet spot; Postgres gives flexible ad-hoc querying for free during a phase where the team doesn't yet know what questions it'll need to ask of the data.

---

## Mechanic authentication: email + password (hand-rolled)

**Chosen:** Email + password, bcrypt hash, JWT session token, Fastify middleware for route protection.
**Rejected:** Keycloak (self-hosted identity server); phone number + SMS OTP.

**Why rejected — Keycloak:** Initially considered for the time savings (Akash has prior Keycloak experience) and as a stepping stone toward future multi-tenancy (workshop org → multiple mechanics → owner role with elevated access). Rejected because: v1 needs only one login per workshop, manually provisioned by the team (no self-serve signup) — Keycloak's multi-tenant/SSO strength isn't needed yet. Hand-rolled auth costs roughly 1–1.5 days of learning time for someone new to Node.js auth patterns, with zero ongoing infrastructure cost. Keycloak would need an always-on container (Docker on AWS), which eats into the ~$84/month per-workshop margin — itself still an unverified assumption at this stage. **Revisit if multi-tenancy becomes a genuine near-term requirement**, not before.

**Why rejected — phone/OTP:** Originally planned (matches the brief's "ninety seconds, no login" spirit for the *customer* side, mistakenly extended to mechanic login too). Changed to email/password because: (1) email/password is genuinely simpler for the person building it — no SMS provider integration needed for login, removes Twilio from the login path entirely (Twilio is still used, only for the customer-facing report link); (2) it keeps a future App Store submission simple — a fixed reviewer demo account works cleanly with email/password, whereas OTP would require Apple's reviewer to receive a real SMS, which isn't practical.

**Provisioning:** For the pilot phase, the team creates each workshop's account directly, matching the in-person onboarding already planned. Self-signup is not a v1 priority.

---

## Mobile distribution: deferred

See "Frontend framework" above — full reasoning lives there since it's the same decision. Documented separately here only to flag: **if this project revisits mobile app distribution, start by re-reading that section before making any new calls.** (The path — Capacitor, TestFlight, App Store submission, associated costs — was written up in more detail in an earlier standalone architecture doc that isn't part of this repo's docs; re-derive or ask Akash for it if this becomes relevant again rather than assuming it's somewhere in `docs/`.)

---

## Hosting

**Chosen (Madhavan's call to finalize):** Amplify Hosting or Fargate for the web app; Fargate or Lambda for the API.

**Note on Lambda:** fine for background workers (SMS sending, image processing) where a few hundred ms of cold start doesn't matter. NOT recommended for the customer-facing report/approval path, where the charter's own <2s load requirement makes cold starts risky. Keep that path on an always-warm Fargate service if Lambda is used elsewhere.

---

## Week 0 status correction (25 Sep 2026)

Madhavan's spike code (presign API + camera capture page) was built and debugged — see `docs/infra-decisions.md` for two real bugs he hit (stale AWS credentials, S3 checksum mode). **Update:** the AWS setup behind that spike (S3 bucket, IAM, credentials) has since been lost and needs rebuilding — this is a regression Madhavan is handling. The documented fixes in `docs/infra-decisions.md` should still apply once AWS is rebuilt, since they were about SDK credential resolution and request signing, not the specific account. Separately and regardless of the AWS setback: the actual field test — compressed file size, upload time on bad signal, survival of phone-lock-mid-upload, survival of tab-reload-mid-upload — has never been captured. That remains the real Week 0 deliverable, not the code existing.

## Timeline correction (25 Sep 2026)

The original charter listed "Week 0 — upload prototype — done." It had not been started. This was caught and corrected; the roadmap was shifted +7 days across every phase (8 Nov → 22 Nov end date) rather than silently compressing elsewhere. See `docs/plan.md` for current dates. **If Claude Code encounters any older document or comment claiming Week 0 is done as of the original charter dates, that claim is wrong — treat the shifted dates as authoritative unless a team member says otherwise.**

---

## Team structure note

Santhosh's role (Scrum Master + Product Owner + business side) was proposed, not yet confirmed as of this writing. If his actual role differs from what's described in `CLAUDE.md`, update both files — don't assume the proposal was accepted without checking.
