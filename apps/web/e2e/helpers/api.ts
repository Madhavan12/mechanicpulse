import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, SEED } from "./fixtures";

/** Logs in over the API and returns the JWT. Use this to set up state for a
 * test whose subject isn't the login screen itself — mechanic-auth.spec.ts
 * covers the real form. */
export async function loginViaApi(request: APIRequestContext, email = SEED.ownerEmail): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email, password: SEED.password },
  });
  expect(res.status(), "login should succeed").toBe(200);
  return (await res.json()).token;
}

export interface SentReport {
  reportId: string;
  token: string;
  reportUrl: string;
  expiresAt: string;
  totalCents: number;
}

/** Sends a report as the mechanic. There's no UI for this yet — the Active Job
 * page that will own the button isn't built — so the API is the only route in.
 * Swap this for a UI interaction once that page exists. */
export async function sendReport(
  request: APIRequestContext,
  jwt: string,
  jobId = SEED.jobId,
  itemIds?: string[]
): Promise<SentReport> {
  const res = await request.post(`${API_URL}/api/jobs/${jobId}/report`, {
    headers: { Authorization: `Bearer ${jwt}` },
    data: itemIds?.length ? { itemIds } : {},
  });
  expect(res.status(), "sending a report should return 201").toBe(201);
  return res.json();
}

/** Logs in through the real form and lands on the job list. */
export async function loginViaUi(page: Page, email = SEED.ownerEmail): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED.password);
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/jobs");
}
