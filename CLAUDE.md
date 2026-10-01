# CLAUDE.md — MechanicPulse

This file is project context for Claude Code. Read this first, every session.

## What this project is

MechanicPulse: a photo-based approval tool for Australian car workshops. Mechanic finds extra work mid-service, photographs the part, tags severity (red/amber/green), sets a price, texts the customer a link. Customer opens it in their phone browser — no login, no app — sees the photo, taps approve or decline.

Currently a time-boxed validation trial (not yet a registered company). Goal by ~22 Nov 2026: a working proof of concept usable to pitch investors. Two checkpoints gate continued investment of time — see `docs/product-decisions.md` and the charter for exact criteria.

## Team

- **Madhavan** — backend, database, cloud infrastructure. Final call on technical/infra decisions. Owns the AWS account (`mechanicpulse.dev@gmail.com`), Terraform, RDS, S3, deployment.
- **Akash (me)** — application development. Mechanic app + customer report page, including upload reliability. De facto technical owner of the app layer.
- **Santhosh** — delivery, customer discovery, and (proposed) Scrum Master + Product Owner + business side (company registration, funding, marketing, cost tracking). Role still being confirmed as of this writing.

## Repo structure (monorepo)

```
/apps/web   — Next.js (React, TypeScript, Tailwind) — mechanic app + customer report page
/apps/api   — Node.js / Fastify — all backend endpoints
```

One repo: `Madhavan12/mechanicpulse`.

## Current stack (confirmed decisions — do not silently change these)

| Layer | Choice |
|---|---|
| Frontend | Next.js (React), **browser-only, no native wrapper** — mechanic app and customer page both run in Safari/Chrome, no install |
| Backend | Node.js / Fastify |
| Database | PostgreSQL on Amazon RDS |
| Object storage | Amazon S3 — presigned URL, direct browser→S3 upload, never through the API. **Note: the original spike's bucket/IAM setup was lost and is being rebuilt by Madhavan as of 25 Sep 2026 — check `docs/plan.md` for current status before assuming a bucket exists.** |
| SMS | Twilio (or AU aggregator — provider not yet finalized) — used only for the customer report link, NOT for mechanic login |
| Auth (mechanic) | Email + password. bcrypt hash + JWT session token + Fastify middleware. NOT phone/OTP. NOT Keycloak. |
| Auth (customer) | None — long random single-use `report_token` in the SMS link, expires after 7 days |
| Hosting | AWS — Amplify Hosting or Fargate for the web app; Fargate or Lambda for the API (final call is Madhavan's) |
| IaC | Terraform |
| Mobile | **Deferred.** No Capacitor, no native app, no App Store work right now. Documented as a future option only — see `docs/product-decisions.md`. Do not add Capacitor/React Native without this being explicitly revisited. |

## Data model (v1)

Full model, ERD and the reasoning: `docs/data-model.md`. Schema: `db/migrations/0001_initial_schema.sql` (PostgreSQL 16+, RDS).

Tables: `workshops`, `mechanics`, `customers`, `vehicles`, `jobs`, `inspection_items`, `media`, `reports`, `report_items`, `approvals`, `sms_messages`, `events`.

Rules to keep: every tenant row carries `workshop_id` (composite FKs block cross-workshop links); money is integer cents; phones are E.164; report tokens are stored only as sha256 hashes; `report_items`, `approvals` and `events` are append-only. Schema changes go through a new numbered migration, never by editing an applied one — and need Madhavan's sign-off.

`events` is the measurement layer (reports sent, links opened, time-to-decision, approval rate) — built in from the start, not bolted on later.

## Things Claude Code should never silently reintroduce

- Keycloak, or any third-party identity provider, for mechanic auth
- Phone number + OTP login for mechanics
- Capacitor, React Native, or any native app work, unless explicitly asked
- A second/separate codebase for mobile

These were all considered and deliberately rejected. Full reasoning is in `docs/product-decisions.md`. If a task seems to call for one of these, stop and ask rather than assuming the earlier decision has changed.

## Where the fuller detail lives

- `docs/product-decisions.md` — the "why" behind every major product/architecture call (stack, auth, mobile-deferred), in more depth than this file
- `docs/infra-decisions.md` — Madhavan's infra playbook (AWS credential gotchas, SDK checksum bugs, and whatever he adds going forward). Different scope from product-decisions.md — check here first for any AWS/deployment error that looks like a signing or credentials issue.
- `docs/plan.md` — sprint plan, current status, what's next
- `docs/design.md` — visual design decisions (color palette, usage rules) locked in before wireframing
- `docs/test-cases.md` — requirement-derived test cases per feature, and whether each is automated. Must be kept current — see README ground rules.

Session-to-session continuity is handled by claude-mem (installed as a Claude Code plugin), not by a manually-maintained handover file.
