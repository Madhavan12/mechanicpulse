# MechanicPulse — Plan

Current status and sprint structure. Update this as sprints progress — this is a living doc, not a static record like `product-decisions.md`.

---

## Current status (as of 1 Oct 2026)

- **Week 0 infra: rebuilt and live.** AWS moved to a new account with IAM Identity Center (SSO) access — see `docs/infra-decisions.md` and the onboarding steps in `docs/aws-setup.md`. No longer a blocker.
- **Week 0 field test: Run 1 done, Run 2 still outstanding.** See `docs/spike-results.md` for the log. Run 1 (compression, on 4G) found and fixed two real bugs — iPhone Safari silently falling back to PNG instead of WebP (made files *bigger*, not smaller), and an S3 CORS wildcard-origin bug. **Still not tested:** fine-detail visibility, upload time on a weak signal, survival of phone-lock mid-upload, survival of tab-reload mid-upload. These need a "Run 2" in an actual weak-signal spot (basement carpark, lift lobby). This — not the code, not Run 1 — remains the real Week 0 gate per the charter.
- **Local monorepo scaffold: done.** Both `apps/web` (Next.js, TypeScript, Tailwind) and `apps/api` (Fastify, rebuilt from the Express spike) run cleanly. CI (typecheck + build + test) covers both apps, plus an automated Claude PR review that runs on every PR.
- **v1 data model: done.** Full Postgres schema, seed data, and ERD in `docs/data-model.md`.
- **Login: done.** Real email/password auth against the `mechanics` table, bcrypt + JWT, per `docs/test-cases.md`.
- **Upload/capture: working, deferred fine-tuning.** Presign + compress + upload flow works end-to-end against real S3; not yet wired into a real job/inspection-item (currently a standalone `/capture` test page).
- **Job List + Create Job: in progress** — see Immediate next tasks.
- AWS staging environment — not yet stood up. Needs a joint discussion with Madhavan before building — he owns the AWS account and Terraform state. (The old "accept Madhavan's IAM invitation" step referenced below is superseded by the SSO onboarding in `docs/aws-setup.md`.)
- Production environment — intentionally not started. Will be created empty/idle, not touched further, until much later.

## Sprint structure

4 sprints of 2 weeks each, shifted to absorb an earlier Week 0 delay (charter originally said 8 Nov end date; corrected to 22 Nov once Week 0 was found to be behind). Note: the sprint boundaries below were drawn up assuming Week 0 just needed the field test run — the AWS rebuild (see Current status above) is a further, not-yet-accounted-for setback. These dates may need another look once the rebuild's time cost is known — flag this in the Santhosh discussion.

| Sprint | Dates (2026) | Focus |
|---|---|---|
| Sprint 1 | 28 Sep – 11 Oct | Upload prototype (Week 0, throwaway) + start of DB/login/capture flow |
| Sprint 2 | 12 – 25 Oct | Finish capture flow + upload reliability on poor signal (the hard sprint — charter itself flags this as hardest, zero schedule slack) |
| Sprint 3 | 26 Oct – 8 Nov | Customer report page, SMS integration, approvals |
| Sprint 4 | 9 – 22 Nov | Hardening, speed, real/unsupervised mechanic test |

**Checkpoints (from the charter, unchanged):**
- **Checkpoint 1**, after 5 workshop visits (Santhosh's track, parallel to Sprint 1): continue if ≥3 of 5 shops raise the phone-approval problem unprompted; redirect if the problem isn't confirmed but another real problem is; stop if <2 of 5 would try a new approval method.
- **Checkpoint 2**, after a 1-week manual test with the friendliest shop: continue if the mechanic is still sending photos by day 4; stop if he stops before day 4.

## Known risk areas (carry into sprint planning)

1. **Sprint 1 stacks two hard deadlines**: the build deliverable AND all 5 workshop visits need to land in the same window, since Checkpoint 1 sits at the end of it. Workshop scheduling is outside the dev team's control and is the kind of thing that slips.
2. **Sprint 3 has a hidden sequential dependency**: report page/SMS/approvals and pilot recruitment are listed as parallel in the charter, but recruitment realistically can't start in earnest until there's something demoable.
3. **No slack anywhere.** ~10 hrs/week per person. One real blocker in the hardest sprint (Sprint 2, uploads) has nowhere to absorb the delay.

## Immediate next tasks (in rough priority order)

1. ~~Madhavan rebuilds the AWS setup for the spike~~ — done, new SSO-based account is live.
2. ~~Finish/verify local monorepo scaffold~~ — done, both `apps/web` and `apps/api` run cleanly in CI.
3. ~~Start the real capture flow: email/password auth~~ — done, see `docs/test-cases.md`.
4. **Run 2 of the Week 0 field test** (Madhavan): basement carpark on one bar, lock the phone mid-upload, reload the tab mid-upload, check compressed photo clarity against a real worn/cracked part. Log results in `docs/spike-results.md`. This is the real gate — the code existing isn't the milestone, the four field numbers are.
5. Complete SSO onboarding (`docs/aws-setup.md`) and have the staging-environment discussion with Madhavan (do not build staging AWS infra solo before this conversation happens)
6. ~~Job List page~~ — done: `GET /api/jobs` endpoint, `AppHeader`/`StatusPill`/`SegmentedControl`/`ListBar` components, the page itself, and a "Create Job" button (button only — it navigates to `/jobs/new`, which doesn't exist yet, that's task 7). `docs/mechanic-pulse-frontend-spec.md`'s Job List section updated to describe the button.
7. **Create Job page**, including the photo-upload step (wires the existing `/capture` upload flow into a real job/inspection-item for the first time) — next after Job List.
8. **Active Job page** (the full checklist/notes/parts-and-labor screen) — after Create Job. (`/login`'s redirect already moved to the real Job List once it existed — done ahead of this.)

## Open items still needing team decisions

- SMS provider: Twilio vs. AU aggregator (affects the ~$84/month margin assumption)
- Santhosh's role: proposed as Scrum Master + Product Owner + business lead, not yet confirmed
- Whether the Checkpoint 1 threshold (3 of 5) still holds once workshop visits are actually booked
- Buffer/slip policy — not yet explicitly agreed as a team, despite being flagged as worth deciding in advance

## Backlog reference

Full epics/features/stories list: `05-Product-Backlog-Epics-Stories.xlsx` (kept outside this repo, in project docs — not committed to git). Epics: Auth, Capture flow, Uploads, Report page, SMS, Approvals, Infra, Measurement, Workshop discovery, Mobile distribution (deferred — greyed out, not active).
