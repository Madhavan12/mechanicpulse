# MechanicPulse — Decision Log

Full reasoning behind every major call, so nobody (human or Claude Code) re-litigates a decision without knowing why it was made. Referenced from `CLAUDE.md`.

---

## Frontend framework: Next.js (React), browser-only

> **Partly superseded on 3 Nov 2026:** the team has decided to wrap the mechanic app with Capacitor. The framework (Next.js/React, one codebase) and "customer page stays in the browser" still stand; "no native wrapper" no longer does. See "Mobile app: Capacitor wrapper" below.

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

> **Superseded on 3 Nov 2026:** the decision is now to go with Capacitor. See "Mobile app: Capacitor wrapper" at the end of this file. The text below is kept for the history.

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

---

## Active Job follows the data model, not the Figma checklist (2 Nov 2026)

The wireframe's Active Job screen has a fixed checklist, a job-level "Mechanic Notes" box and a "Parts & Labor" card. The v1 schema has none of those: it has *findings* (`inspection_items` — title, severity, note, price) with photos, and the customer report is a frozen snapshot of exactly those.

**Chosen:** build the screen around findings. The mechanic adds what they found; the Estimate card is just the findings' prices summed. No checklist template, no job-level notes, no separate parts/labor lines, no "Save Draft" (each finding saves as it's added).

**Why:** matches how the mechanic actually works (they find something, photograph it, price it) and what the customer approves item-by-item. A checklist template or job-level notes would need a schema migration (Madhavan's sign-off) for no part of the validation trial's question.

**Revisit if:** shop visits show mechanics want a standard checklist to tick through, or a place for notes that aren't customer-facing.

---

## Photos: orphaned S3 files are acceptable for the trial (2 Nov 2026)

Deleting a photo or a finding removes the database row but not the S3 object, and abandoned uploads leave rows and objects behind. **Accepted** for the validation trial: the volume is tiny, the bucket is private, and nothing user-visible depends on the leftovers (the row is what makes a photo appear on a finding or a report). A cleanup job is tracked under "Known gaps" in `docs/plan.md`.

**Also decided:** a failed or long-abandoned (15 min) upload stops counting against the 4-photo cap, so a bad connection never locks a finding out of photos; and the API reads a photo's size from S3 at confirm time rather than trusting the browser.

## SMS delivery: Twilio behind an interface; the report is never held hostage by the text (3 Nov 2026)

**Provider: Twilio** for the proof of concept (chosen 3 Nov). All provider code sits behind a small `SmsProvider` interface (`apps/api/src/lib/sms/`), so moving to an AU aggregator later is one new file and an env var. The default provider is a **console logger**, used in dev, CI and the e2e suite, so nothing real is sent unless `SMS_PROVIDER=twilio` and its three credentials are set (a half-configured Twilio fails at startup, not at a customer's first text). Twilio is called with plain `fetch`; the SDK isn't worth a dependency for one endpoint.

**Sender for the POC: a plain Twilio number, not an alphanumeric sender ID** (we don't have one registered). `TWILIO_FROM` takes a phone number or a Messaging Service SID (`MG…`), so adding a registered sender ID later is config only. The text names the workshop so the customer can tell who it's from. Registering a sender ID (and the AU number's regulatory bundle, if we use an AU number) has lead time and is tracked in `docs/plan.md`.

**The report is committed first, the text is best-effort after.** If the provider is down, the report still exists and the mechanic still gets the link, with a clear "the customer has NOT been told" message. The alternative (rolling the report back on an SMS failure) would turn a Twilio outage into lost quotes. Every attempt is recorded in `sms_messages` and as `sms.sent` / `sms.failed` / `sms.delivered` events with actor `system`, so upload and delivery reliability are measurable like everything else.

**Opt-out and limits.** A customer with `sms_opted_out_at` is never texted (Spam Act). At most 5 texts per job per hour and 300 per workshop per day, so a bug or a hammered button can't spam anyone or run up the bill.

**Delivery receipts** come from Twilio to `POST /api/sms/twilio/status`, verified by Twilio's HMAC signature (no valid signature, `403`). Only `delivered`, `undelivered` and `failed` change anything, and only on messages that aren't already final, so out-of-order callbacks can't overwrite a result. Callbacks need `PUBLIC_API_URL`; without it the message stays at `sent`.

**Resend = revoke and reissue.** Tokens are stored only as hashes, so a lost link can't be shown again. "Send a new link" revokes the live report and creates a new one with a **copy of the same frozen findings and total**, so the quote the customer sees doesn't change, only the link. It is refused once the customer has responded (that record must not be replaced). A customer opening the old link sees "this link is no longer active" rather than "withdrawn", since a resend isn't the workshop taking the quote back.

**Known gap:** inbound STOP replies aren't handled by us. Twilio blocks further texts to a number that replied STOP (we'd record a failed text), but `customers.sms_opted_out_at` isn't set from it. Fine for the trial; an inbound webhook is the fix.

## Staging hosting: Fargate for both apps behind one CloudFront address (3 Nov 2026)

Built by Akash while Madhavan was unavailable, so the proof of concept wasn't blocked. **For Madhavan's review**; nothing here is final until he's looked. Runbook: `docs/deploy-staging.md`. Code: `infra/staging/` (Terraform, own state, nothing shared with existing resources).

**Shape:** ECS Fargate runs the API and the web app (both containers, ARM); an Application Load Balancer routes `/api/*` and `/health` to the API and everything else to the web app; CloudFront sits in front and gives the site a trusted `https://` address; RDS Postgres 16 sits in private subnets; photos go to their own S3 bucket. The ALB only accepts traffic that carries CloudFront's secret header.

**Why one address for web and API:** the browser then talks to a single origin, so there is no CORS to configure and no mixed-content blocking, and the web image has no environment-specific values baked in (`NEXT_PUBLIC_API_URL` is empty = same origin).

**Why CloudFront in front of the ALB:** a trusted certificate on the ALB needs a domain we don't have. CloudFront's default certificate gives HTTPS today, and the phone needs HTTPS for the camera, clipboard and other secure-page features (the Android upload bug on 3 Nov was `crypto.randomUUID` missing on a plain-http page). A custom domain can be attached later.

**Why not Amplify Hosting (the option named under "Hosting"):** connecting Amplify to GitHub installs a webhook, which needs admin rights on the repository, and Akash has `push` but not `admin` on it. Next.js 16 support on Amplify is also unconfirmed. Revisit once Madhavan can connect it; the web container is a straight swap.

**Deliberate shortcuts for a proof of concept** (listed with their fixes in the runbook): no NAT gateway (containers have public IPs behind a locked-down security group), database TLS encrypted but not verified, secrets in the Terraform state, manual deploys, one database in one Availability Zone.

**Also done for this:** the API's `npm start` pointed at a file that doesn't exist (`dist/index.js`; the build writes to `dist/apps/api/src/index.js`), so it was fixed; a migration runner and a "create first login" script were added instead of loading the demo seed, whose logins share the public password `password123`.


## Mobile app: Capacitor wrapper (3 Nov 2026)

**Decided:** the mechanic app will be wrapped with Capacitor and distributed as an iOS and Android app. This reverses the earlier "browser-only, mobile deferred" call (the first two sections of this file). **Parked:** it starts after the proof of concept, which is considered complete on staging as of 3 Nov 2026. Nothing has been built, and no Capacitor or native code has been added to the repo.

**Why a wrapped app at all (Akash, 3 Nov 2026):** the product should end up properly mobile-friendly, and for a mechanic working on a phone an installed app is better than a web page: it sits on the home screen, opens straight to the app, and has direct access to the camera. The mechanic uses it standing at a car with dirty hands, so fewer taps and a more reliable camera matter.

**What stays the same** (these were the reasons for avoiding a second codebase, and they still hold):
- **One codebase.** Capacitor is a shell around the same Next.js/React app, not a rewrite. React Native and a separate mobile codebase stay rejected.
- **The customer never installs anything.** The report link in the text opens in the phone's browser: no app, no login. Only the mechanic's app is wrapped.
- **Auth, the API and the data model don't change.** Email + password with a JWT; no Keycloak, no phone/OTP login.

### Why Capacitor over the alternatives

"Capacitor docs" means pages read on 3 Nov 2026. "Background" is general knowledge that wasn't checked against a source; verify it before relying on it.

| Option | Verdict | Reasoning |
|---|---|---|
| **Capacitor** | **Chosen** | Capacitor docs: "Capacitor is a cross-platform native runtime that makes it easy to build performant mobile applications that run natively on iOS, Android, and more using modern web tooling", and "If it works in the browser, it probably works in a mobile app when using Capacitor." It runs the existing web app inside a native shell and adds device features through plugins, so the Next.js/React/Tailwind work is reused. The Camera plugin covers taking a photo or picking one on iOS and Android (Capacitor docs). |
| Stay a web app / PWA | Not enough | The wrapper is wanted for the home-screen app and native camera. Capacitor's own camera plugin falls back to a plain file-input on the web (Capacitor docs). Background: an installed web app on iPhone is a manual "Add to Home Screen", with no App Store presence and fewer device features. |
| Cordova | Older approach | The Capacitor docs call Capacitor "the next evolution of Hybrid apps" and include a guide for migrating from Cordova. Starting a new project on Cordova would mean starting on the older tool. (The comparison pages themselves weren't read.) |
| React Native | Rejected (as before) | It would mean writing the mechanic UI a second time in a separate framework. Background: web components and Tailwind styles can't be reused as they are. |
| Fully native (Swift and Kotlin) or Flutter | Rejected | One or two new codebases and new skills for a small team, with no gain that matters for a photo-and-approval tool. Background. |

### Correction to the earlier proposal: load the app from the shell, not from a URL

An earlier draft of this section proposed pointing the Capacitor shell at the deployed site with `server.url`, so web deploys would update the app. **Capacitor's docs say the opposite:** `server.url` is "intended for use with live-reload servers" and "This is not intended for use in production." Apple's review guidelines (4.2) also reject apps that are "a repackaged website" (the wording is from a summary of the page, not copied; check the live page). So the production app should **bundle** the built web code inside the app. That has real consequences:

1. **The mechanic screens must be buildable as a static export** (`output: "export"` in Next.js). Today `/jobs/[id]` and others are server-rendered, and `/jobs/[id]` has a runtime id in the path, so it needs rework (for example, reading the id from the query string on the client). The size of this has not been estimated; the earlier "hours to a day" estimate in the first section assumed a simpler wrapper and should not be relied on.
2. **API calls become cross-origin.** The staging site is deliberately one origin so there's no CORS. A bundled app runs from its own origin (by default `capacitor://localhost` on iOS and `https://localhost` on Android; verify against the current Capacitor config), so `NEXT_PUBLIC_API_URL` must be the full API address, and the API's CORS (`apps/api/src/app.ts` currently allows a single `WEB_ORIGIN`) and the photo bucket's CORS (`infra/staging/storage.tf`) both need to allow the app's origin.
3. **Two builds from one codebase.** The customer page (`/r/[token]`) stays server-rendered on the web, so the web app is still deployed as it is. The mobile build contains only the mechanic routes.
4. **Releases go through the stores.** A web deploy no longer updates the app instantly, so the API must stay backward compatible with older installed app versions, or the app needs a forced-update check.

### Plan (when it starts)

1. Spike: static-export the mechanic routes (login, job list, new job, active job) and run them in a Capacitor shell on a device against staging. This answers the size question in point 1 above.
2. Camera: replace the browser camera on the finding form with Capacitor's camera plugin. Photos still upload straight to S3 through a presigned URL.
3. Add a Capacitor project to the repo (suggest `apps/mobile`: config and native projects only, no copied web code).
4. TestFlight and an Android internal test track, pointed at staging, before any public release.

### Open items

- **Developer accounts.** Apple Developer Program is US$99 a year (Apple's programs page, 3 Nov 2026) and Google Play has a US$25 one-time fee (Google's help page). Apple allows enrolment "as an individual or organization"; what an organisation account needs (such as a D-U-N-S number) wasn't confirmed. Google says personal accounts must complete app-testing requirements before distributing, and may need government ID. Who owns the accounts depends on whether a company exists by then: Santhosh.
- **App Store review.** The native camera (and push notifications, if added) is what gives the app value beyond a website. Check guideline 4.2 on Apple's site before submitting.
- **Push notifications** (for example, telling the mechanic that the customer decided) are a possible next step, not part of this decision.
