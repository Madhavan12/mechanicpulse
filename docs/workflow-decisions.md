# MechanicPulse — Workflow/Tooling Decisions

Reasoning behind the repo's automation and process setup (CI, bots, dev workflow) — same spirit as `product-decisions.md`, but for how we work rather than what we're building. Record the "why" here so it isn't re-litigated.

---

## Claude PR review: custom prompt instead of the packaged `/code-review` skill

**Chosen:** a direct prompt in `.github/workflows/claude-review.yml` that always reviews every non-draft PR and always posts exactly one summary comment.

**Rejected:** Anthropic's packaged `code-review` plugin/skill (`/code-review:code-review --comment`).

**Why:** the packaged skill's own instructions include a step-1 "gatekeeper" check — a quick pass that decides whether a PR is even worth reviewing (skipping closed/draft PRs, "automated" PRs, or changes it judges "trivial"/"obviously correct") before doing any real review. In practice this gatekeeper proved unreliable:

- On PR #34 (a small, genuinely low-risk CSS-variables-and-docs PR), it skipped and posted nothing — arguably a reasonable call, but silent, so there was no way to tell "nothing to flag" from "didn't run."
- On PR #36 (a real feature PR — new Fastify auth endpoint, JWT handling, bcrypt checks, a new frontend login flow), it skipped again. `num_turns: 2` in the run log — nowhere near enough turns for the real 4-agent parallel review pipeline the skill describes — strongly suggests the gatekeeper decided to skip even here, on exactly the kind of security-relevant change you'd most want reviewed.

Two skips on two different kinds of PR, with no visible reasoning (`show_full_output` is off by default) and no comment either way, undermined the point of having automated review at all — you couldn't tell from the PR whether it had been checked and found clean, or not checked.

**Tradeoff accepted:** the packaged skill ran a heavier review (4 parallel agents — 2 for CLAUDE.md compliance, 2 for bugs/security — plus a validation pass per flagged issue to cut false positives). The custom prompt is a single, simpler pass. In exchange, it's guaranteed to always leave a comment — either real findings or an explicit "No issues found" — so the PR always shows whether it was reviewed, never silence.

**Revisit if:** false positives or missed issues become a real problem with the simpler single-pass prompt — at that point, consider re-adding a validation step rather than going back to the gatekept skill, since the silent-skip behavior is the specific thing being avoided here.

**Still true regardless of which approach is used:** no GitHub App install is needed (would require repo admin access nobody currently has) — both the packaged-skill version and the custom-prompt version authenticate via `github_token: ${{ secrets.GITHUB_TOKEN }}` and a `CLAUDE_CODE_OAUTH_TOKEN` repo secret.
