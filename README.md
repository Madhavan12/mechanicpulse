# mechanicpulse

## Ground rules

- **All code must be reviewed by Akash Ramesh before merging.**
- No direct pushes to `main` — all changes go through a pull request.
- **Branch naming:**
  - `feature/<thing-being-built>` — e.g. `feature/customer-report-page`
  - `bugfix/<DD-MM-YYYY>-<bug-name>` — e.g. `bugfix/25-09-2026-upload-crash-on-tab-reload`
  - `cleanup/<DD-MM-YYYY>-<task-name>` — e.g. `cleanup/25-09-2026-gitignore`
- **Never commit secrets** — no `.env` files, AWS keys, or credentials in code, commit messages, or config. `.env` is gitignored; keep it that way.
- **Infra/AWS/Terraform changes need Madhavan's sign-off** before merging — he owns the AWS account and final call on technical/infra decisions.
- Keep PRs small and scoped to one feature or fix, and delete the branch after merging.
- Every PR must include a description of what changed and why, for the reviewer.
- If a PR changes a decision recorded in `docs/product-decisions.md` (stack, auth approach, etc.), update that doc in the same PR.
- **`docs/test-cases.md` must be updated in the same PR as the development it describes** — new feature, new test cases; changed behavior, updated expected results; a case that's now automated, updated status.