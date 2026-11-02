import { test, expect } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, loginViaUi, sendReport } from "./helpers/api";
import { API_URL, money, SEED, TOTAL_CENTS } from "./helpers/fixtures";
import { gotoReady } from "./helpers/nav";

test.beforeEach(resetDb);

const OTHER_JOB_ID = "00000000-0000-0000-0000-00000000b0ff";
const OTHER_ITEM_ID = "00000000-0000-0000-0000-00000000d0ff";

/** A complete job + finding in a second workshop, to prove the first can't see it. */
async function seedOtherWorkshop() {
  const W = "00000000-0000-0000-0000-000000000002";
  await query(
    `INSERT INTO workshops (id, name, phone_e164, sms_sender_id, timezone)
     VALUES ($1, 'Other Shop', '+61390000001', 'OtherShp', 'Australia/Sydney')`,
    [W]
  );
  await query(
    `INSERT INTO mechanics (id, workshop_id, name, email, password_hash, role)
     SELECT '00000000-0000-0000-0000-00000000a0ff', $1, 'Other Mech', 'other@other.test', password_hash, 'owner'
       FROM mechanics WHERE email = 'owner@demo.test'`,
    [W]
  );
  await query(
    `INSERT INTO customers (id, workshop_id, name, mobile_e164)
     VALUES ('00000000-0000-0000-0000-00000000c0ff', $1, 'Other Customer', '+61455000001')`,
    [W]
  );
  await query(
    `INSERT INTO vehicles (id, workshop_id, customer_id, rego)
     VALUES ('00000000-0000-0000-0000-00000000e0ff', $1, '00000000-0000-0000-0000-00000000c0ff', 'OTH111')`,
    [W]
  );
  await query(
    `INSERT INTO jobs (id, workshop_id, vehicle_id, customer_id, created_by)
     VALUES ($1, $2, '00000000-0000-0000-0000-00000000e0ff', '00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-00000000a0ff')`,
    [OTHER_JOB_ID, W]
  );
  await query(
    `INSERT INTO inspection_items (id, job_id, title, severity, price_cents)
     VALUES ($1, $2, 'Other shop finding', 'red', 10000)`,
    [OTHER_ITEM_ID, OTHER_JOB_ID]
  );
}

async function openSeedJob(page: import("@playwright/test").Page) {
  await loginViaUi(page);
  await gotoReady(page, `/jobs/${SEED.jobId}`);
  await expect(page.getByRole("heading", { name: /Toyota Corolla — ABC123/ })).toBeVisible();
}

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog");
const total = (page: import("@playwright/test").Page) => page.getByTestId("estimate-total");

test.describe("Active Job — page", () => {
  test("opens from the Job List and shows the job, its findings and the total", async ({ page }) => {
    await loginViaUi(page);
    await page.locator("div.bg-card", { hasText: SEED.vehicle }).first().getByRole("button", { name: "Open" }).first().click();
    await page.waitForURL(`**/jobs/${SEED.jobId}`);

    await expect(page.getByRole("heading", { name: /Toyota Corolla — ABC123/ })).toBeVisible();
    await expect(page.getByText(SEED.customerName).first()).toBeVisible();
    await expect(page.getByText(SEED.brakeTitle).first()).toBeVisible();
    await expect(page.getByText(SEED.wiperTitle).first()).toBeVisible();
    await expect(total(page)).toHaveText(money(TOTAL_CENTS));
  });

  test("adds a finding: it appears, the total updates, and it is stored in cents", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();

    await dialog(page).getByLabel("Title").fill("Rear tyre sidewall crack");
    await dialog(page).getByRole("radio", { name: "Urgent" }).click();
    await dialog(page).getByLabel("Price ($)").fill("$1,120.50");
    await dialog(page).getByLabel("Note (optional)").fill("Replace both rears");
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText("Rear tyre sidewall crack").first()).toBeVisible();
    await expect(total(page)).toHaveText(money(TOTAL_CENTS + 112050));

    const row = await query<{ price_cents: number; severity: string; note: string; position: number }>(
      "SELECT price_cents, severity, note, position FROM inspection_items WHERE title = 'Rear tyre sidewall crack'"
    );
    expect(row[0]).toMatchObject({ price_cents: 112050, severity: "red", note: "Replace both rears", position: 2 });
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'item.added'")).toBe("1");
  });

  test("a finding survives a reload", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await dialog(page).getByLabel("Title").fill("Persisted finding");
    await dialog(page).getByRole("radio", { name: "Good" }).click();
    await dialog(page).getByLabel("Price ($)").fill("0");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toBeHidden();

    await page.reload();
    await expect(page.getByText("Persisted finding").first()).toBeVisible();
    // A $0 finding is allowed and doesn't change the total.
    await expect(total(page)).toHaveText(money(TOTAL_CENTS));
  });

  test("edits a finding", async ({ page }) => {
    await openSeedJob(page);
    await page.getByText(SEED.brakeTitle).first().click();
    await expect(dialog(page).getByLabel("Price ($)")).toHaveValue("289.00");

    await dialog(page).getByLabel("Price ($)").fill("300");
    await dialog(page).getByRole("radio", { name: "Monitor" }).click();
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(total(page)).toHaveText(money(30000 + SEED.wiperCents));
    expect(await scalar("SELECT price_cents FROM inspection_items WHERE id = $1", [SEED.brakeItemId])).toBe("30000");
    expect(await scalar("SELECT severity FROM inspection_items WHERE id = $1", [SEED.brakeItemId])).toBe("amber");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'item.updated'")).toBe("1");
  });

  test("deletes a finding only after confirming", async ({ page }) => {
    await openSeedJob(page);
    await page.getByText(SEED.wiperTitle).first().click();

    await dialog(page).getByRole("button", { name: "Delete finding" }).click();
    await dialog(page).getByRole("button", { name: "Keep" }).click();
    expect(await scalar("SELECT count(*) FROM inspection_items WHERE id = $1", [SEED.wiperItemId])).toBe("1");

    await dialog(page).getByRole("button", { name: "Delete finding" }).click();
    await dialog(page).getByRole("button", { name: "Yes, delete" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText(SEED.wiperTitle)).toHaveCount(0);
    await expect(total(page)).toHaveText(money(SEED.brakeCents));
    expect(await scalar("SELECT count(*) FROM inspection_items WHERE id = $1", [SEED.wiperItemId])).toBe("0");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'item.deleted'")).toBe("1");
  });

  test("shows inline errors and writes nothing for an empty form", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(dialog(page).getByRole("alert")).toHaveCount(3);
    await expect(dialog(page).getByText("Enter a title for this finding.")).toBeVisible();
    await expect(dialog(page).getByText("Choose Good, Monitor or Urgent.")).toBeVisible();
    await expect(dialog(page).getByText(/Enter a price in dollars/)).toBeVisible();
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");
  });

  test("rejects a price with more than two decimals", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await dialog(page).getByLabel("Title").fill("x");
    await dialog(page).getByRole("radio", { name: "Good" }).click();
    await dialog(page).getByLabel("Price ($)").fill("10.999");
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(dialog(page).getByText(/Enter a price in dollars/)).toBeVisible();
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");
  });

  test("Cancel and Escape close the form without saving", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await dialog(page).getByLabel("Title").fill("Never saved");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();

    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");
  });

  test("a brand-new job starts empty and becomes In Progress after its first finding", async ({ page }) => {
    await loginViaUi(page);
    await gotoReady(page, "/jobs/new");
    await page.getByLabel("Name").fill("Pat New");
    await page.getByLabel("Mobile").fill("0455 777 888");
    await page.getByLabel("Rego").fill("NEW123");
    await page.getByRole("button", { name: "Create Job" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);

    await expect(page.getByText("No findings yet")).toBeVisible();
    await expect(page.getByText("Not Started").first()).toBeVisible();
    await expect(total(page)).toHaveText("$0.00");

    await page.getByRole("button", { name: "+ Add Finding" }).click();
    await dialog(page).getByLabel("Title").fill("Oil leak");
    await dialog(page).getByRole("radio", { name: "Monitor" }).click();
    await dialog(page).getByLabel("Price ($)").fill("80");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("In Progress").first()).toBeVisible();
  });

  test("a sent job is read-only", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);

    await openSeedJob(page);
    await expect(page.getByText(/has been sent to the customer/)).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add Finding" })).toHaveCount(0);
    // Tapping a finding does nothing.
    await page.getByText(SEED.brakeTitle).first().click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("shows 'Job not found' for an unknown job and for another workshop's job", async ({ page }) => {
    await seedOtherWorkshop();
    await loginViaUi(page);

    await gotoReady(page, "/jobs/00000000-0000-0000-0000-0000000000aa");
    await expect(page.getByRole("heading", { name: "Job not found" })).toBeVisible();

    await gotoReady(page, `/jobs/${OTHER_JOB_ID}`);
    await expect(page.getByRole("heading", { name: "Job not found" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Other shop finding");
    await expect(page.locator("body")).not.toContainText("OTH111");
  });

  test("sends a logged-out visitor to /login", async ({ page }) => {
    await page.goto(`/jobs/${SEED.jobId}`);
    await page.waitForURL("**/login");
  });
});

test.describe("Active Job — API against a real database", () => {
  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
  const item = { title: "API finding", severity: "amber", priceCents: 5000 };

  test("every endpoint requires authentication", async ({ request }) => {
    const j = `${API_URL}/api/jobs/${SEED.jobId}`;
    expect((await request.get(j)).status()).toBe(401);
    expect((await request.post(`${j}/items`, { data: item })).status()).toBe(401);
    expect((await request.patch(`${j}/items/${SEED.brakeItemId}`, { data: item })).status()).toBe(401);
    expect((await request.delete(`${j}/items/${SEED.brakeItemId}`)).status()).toBe(401);
  });

  test("GET returns the job with findings and a total in cents", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await request.get(`${API_URL}/api/jobs/${SEED.jobId}`, { headers: auth(jwt) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: SEED.jobId, vehicleRego: SEED.rego, totalCents: TOTAL_CENTS, displayStatus: "in_progress" });
    expect(body.items.map((i: { title: string }) => i.title)).toEqual([SEED.brakeTitle, SEED.wiperTitle]);
  });

  test("another workshop's job and findings are invisible and untouchable", async ({ request }) => {
    await seedOtherWorkshop();
    const jwt = await loginViaApi(request);
    const other = `${API_URL}/api/jobs/${OTHER_JOB_ID}`;

    expect((await request.get(other, { headers: auth(jwt) })).status()).toBe(404);
    expect((await request.post(`${other}/items`, { headers: auth(jwt), data: item })).status()).toBe(404);
    expect((await request.patch(`${other}/items/${OTHER_ITEM_ID}`, { headers: auth(jwt), data: item })).status()).toBe(404);
    expect((await request.delete(`${other}/items/${OTHER_ITEM_ID}`, { headers: auth(jwt) })).status()).toBe(404);

    // Nothing moved.
    expect(await scalar("SELECT count(*) FROM inspection_items WHERE job_id = $1", [OTHER_JOB_ID])).toBe("1");
    expect(await scalar("SELECT title FROM inspection_items WHERE id = $1", [OTHER_ITEM_ID])).toBe("Other shop finding");
  });

  test("a finding id from a different job can't be edited through this job's URL", async ({ request }) => {
    await seedOtherWorkshop();
    const jwt = await loginViaApi(request);
    const res = await request.patch(`${API_URL}/api/jobs/${SEED.jobId}/items/${OTHER_ITEM_ID}`, { headers: auth(jwt), data: item });
    expect(res.status()).toBe(404);
    expect(await scalar("SELECT title FROM inspection_items WHERE id = $1", [OTHER_ITEM_ID])).toBe("Other shop finding");
  });

  test("a sent job refuses add, edit and delete with 409 and changes nothing", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);
    const j = `${API_URL}/api/jobs/${SEED.jobId}`;

    expect((await request.post(`${j}/items`, { headers: auth(jwt), data: item })).status()).toBe(409);
    expect((await request.patch(`${j}/items/${SEED.brakeItemId}`, { headers: auth(jwt), data: item })).status()).toBe(409);
    expect((await request.delete(`${j}/items/${SEED.brakeItemId}`, { headers: auth(jwt) })).status()).toBe(409);

    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");
    expect(await scalar("SELECT price_cents FROM inspection_items WHERE id = $1", [SEED.brakeItemId])).toBe(String(SEED.brakeCents));
  });

  test("bad fields return 400 naming the field and write nothing", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const url = `${API_URL}/api/jobs/${SEED.jobId}/items`;
    for (const [bad, field] of [
      [{ ...item, title: " " }, "title"],
      [{ ...item, severity: "blue" }, "severity"],
      [{ ...item, priceCents: -1 }, "priceCents"],
      [{ ...item, priceCents: 1.5 }, "priceCents"],
    ] as const) {
      const res = await request.post(url, { headers: auth(jwt), data: bad });
      expect(res.status()).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'item.added'")).toBe("0");
  });

  test("a finding added here shows up on the report the customer receives", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await request.post(`${API_URL}/api/jobs/${SEED.jobId}/items`, { headers: auth(jwt), data: { ...item, title: "Added then sent" } });
    const report = await sendReport(request, jwt);

    expect(report.totalCents).toBe(TOTAL_CENTS + 5000);
    const view = await (await request.get(`${API_URL}/api/report/${report.token}`)).json();
    expect(view.items.map((i: { title: string }) => i.title)).toContain("Added then sent");
  });
});
