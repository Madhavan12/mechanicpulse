# MechanicPulse — Plan

Current status and sprint structure. Update this as sprints progress — this is a living doc, not a static record like `product-decisions.md`.

---

## Current status (as of 25 Sep 2026)

- **Week 0 (upload prototype): infra lost, needs rebuilding.** Madhavan's original AWS setup for the spike (S3 bucket, IAM, credentials) is gone and needs to be recreated — this is a regression, not just an unfinished task. The spike *code* (presign API, camera capture page) and the two infra bugs he'd already solved (stale AWS credentials, S3 checksum mode) are documented in `docs/infra-decisions.md` and should still be valid once the AWS setup is rebuilt — the fixes were about how the SDK resolves credentials and signs requests, not about the specific bucket/account, so they should still apply. But nothing can be field-tested until the AWS side exists again. Madhavan is handling this rebuild.
- **The actual Week 0 deliverable — four field-test numbers (compressed file size, upload time on bad signal, survives phone lock mid-upload, survives tab reload) — has never been captured.** This remains true regardless of the AWS setback; it was never done even when the infra existed.
- Local monorepo scaffold (Next.js in `/apps/web`, Fastify in `/apps/api`) — in progress / just completed as of the last session. Check git log for actual state.
- AWS staging environment — not yet stood up. Akash has an IAM invitation from Madhavan, not yet accepted. Needs a joint discussion with Madhavan before building — he owns the AWS account and Terraform state.
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

1. Madhavan rebuilds the AWS setup for the spike (S3 bucket, IAM, credentials) — his current task
2. Finish/verify local monorepo scaffold — both `apps/web` and `apps/api` run cleanly, pushed to `Madhavan12/mechanicpulse`
3. Once AWS is rebuilt, run the actual Week 0 field test: basement carpark on one bar, lock the phone mid-upload, reload the tab mid-upload, check compressed photo clarity against a real worn/cracked part. Write results down (location TBD — the previous runbook doc was removed; confirm with Madhavan where this should live now). This is the real gate — the code existing isn't the milestone, the four field numbers are.
4. Accept Madhavan's IAM invitation and have the staging-environment discussion with him (do not build staging AWS infra solo before this conversation happens)
5. Once Week 0's field test proves the path, throw the spike away and start the real capture flow (job creation, line items, email/password auth) per Sprint 1–2 scope

## Open items still needing team decisions

- SMS provider: Twilio vs. AU aggregator (affects the ~$84/month margin assumption)
- Santhosh's role: proposed as Scrum Master + Product Owner + business lead, not yet confirmed
- Whether the Checkpoint 1 threshold (3 of 5) still holds once workshop visits are actually booked
- Buffer/slip policy — not yet explicitly agreed as a team, despite being flagged as worth deciding in advance

## Backlog reference

Full epics/features/stories list: `05-Product-Backlog-Epics-Stories.xlsx` (kept outside this repo, in project docs — not committed to git). Epics: Auth, Capture flow, Uploads, Report page, SMS, Approvals, Infra, Measurement, Workshop discovery, Mobile distribution (deferred — greyed out, not active).
