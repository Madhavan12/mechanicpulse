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
## Running the tests

```bash
# API unit tests (no database needed)
cd apps/api && npm test

# Browser (e2e) tests — need Postgres on port 5433. The suite wipes and re-seeds
# that database on every run, so use a throwaway container, not data you care about.
docker run -d --name mp-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=mechanicpulse_dev postgres:16   # first time only
cd apps/web && npm install && npx playwright install                          # first time only
npm run test:e2e                      # whole suite; Playwright starts the API and web servers itself
npx playwright test create-job        # one spec
```

The suite resets the database to the seed before each test and again when it finishes, so the dev app is usable afterwards.

To log in by hand (`owner@demo.test` / `password123`), the demo user must be in the database: run the e2e suite once, or load `db/migrations/0001_initial_schema.sql` then `db/seed/dev_seed.sql`.
