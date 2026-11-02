import { test, expect } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, loginViaUi } from "./helpers/api";
import { API_URL, SEED } from "./helpers/fixtures";
import { gotoReady } from "./helpers/nav";

test.beforeEach(resetDb);

const jobCount = () => scalar("SELECT count(*) FROM jobs");

test.describe("Create Job — page", () => {
  test("creates a job from the Job List and shows it as Not Started", async ({ page }) => {
    await loginViaUi(page);
    await page.getByRole("button", { name: "+ New Job" }).click();
    await page.waitForURL("**/jobs/new");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Name").fill("Sam Newcustomer");
    await page.getByLabel("Mobile").fill("0455 111 222");
    await page.getByLabel("Rego").fill("xyz 789");
    await page.getByLabel("Make").fill("Mazda");
    await page.getByLabel("Model").fill("3");
    await page.getByLabel("Odometer (km)").fill("120000");
    await page.getByRole("button", { name: "Create Job" }).click();

    await page.waitForURL("**/jobs");
    const card = page.locator("div.bg-card", { hasText: "Mazda 3" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Not Started").first()).toBeVisible();

    expect(await jobCount()).toBe("2");
    expect(await scalar("SELECT mobile_e164 FROM customers WHERE name = 'Sam Newcustomer'")).toBe("+61455111222");
    expect(await scalar("SELECT odometer_km FROM jobs ORDER BY created_at DESC LIMIT 1")).toBe("120000");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'job.created'")).toBe("2");
  });

  test("shows inline errors and writes nothing when required fields are empty", async ({ page }) => {
    await loginViaUi(page);
    await gotoReady(page, "/jobs/new");
    await page.getByRole("button", { name: "Create Job" }).click();

    await expect(page.locator('form [role="alert"]')).toHaveCount(3);
    await expect(page.getByText("Enter the customer's name.")).toBeVisible();
    await expect(page.getByText(/Australian mobile number/)).toBeVisible();
    await expect(page.getByText(/rego of up to 9/)).toBeVisible();
    await expect(page).toHaveURL(/\/jobs\/new$/);
    expect(await jobCount()).toBe("1");
  });

  test("Cancel goes back to the Job List without creating anything", async ({ page }) => {
    await loginViaUi(page);
    await gotoReady(page, "/jobs/new");
    await page.getByLabel("Name").fill("Someone");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.waitForURL("**/jobs");
    expect(await jobCount()).toBe("1");
  });

  test("sends a logged-out visitor to /login", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.waitForURL("**/login");
  });
});

test.describe("Create Job — API against a real database", () => {
  async function create(request: import("@playwright/test").APIRequestContext, jwt: string, data: object) {
    return request.post(`${API_URL}/api/jobs`, { headers: { Authorization: `Bearer ${jwt}` }, data });
  }

  test("rejects an unauthenticated request", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/jobs`, { data: {} });
    expect(res.status()).toBe(401);
  });

  test("reuses the existing customer and vehicle and keeps the stored name", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await create(request, jwt, {
      customerName: "Alex Typo",
      customerMobile: "0412 345 678", // the seed customer
      rego: "abc 123", // the seed vehicle
    });
    expect(res.status()).toBe(201);

    expect(await scalar("SELECT count(*) FROM customers")).toBe("1");
    expect(await scalar("SELECT count(*) FROM vehicles")).toBe("1");
    expect(await scalar("SELECT name FROM customers")).toBe(SEED.customerName);
    expect(await scalar("SELECT make FROM vehicles")).toBe("Toyota"); // blank input doesn't wipe it
    expect(await jobCount()).toBe("2");
  });

  test("a car that changed hands moves to the new owner; the old job keeps its customer", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await create(request, jwt, { customerName: "New Owner", customerMobile: "0466 000 111", rego: SEED.rego });
    expect(res.status()).toBe(201);

    expect(await scalar("SELECT count(*) FROM vehicles")).toBe("1");
    const owner = await scalar("SELECT c.name FROM vehicles v JOIN customers c ON c.id = v.customer_id");
    expect(owner).toBe("New Owner");
    const oldJobCustomer = await scalar("SELECT c.name FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = $1", [SEED.jobId]);
    expect(oldJobCustomer).toBe(SEED.customerName);
  });

  test("another workshop's customer and vehicle are not touched or reused", async ({ request }) => {
    await query(
      `INSERT INTO workshops (id, name, phone_e164, sms_sender_id, timezone)
       VALUES ('00000000-0000-0000-0000-000000000002', 'Other Shop', '+61390000001', 'OtherShp', 'Australia/Sydney')`
    );
    await query(
      `INSERT INTO customers (id, workshop_id, name, mobile_e164)
       VALUES ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000002', 'Other Shop Customer', '+61455000999')`
    );
    await query(
      `INSERT INTO vehicles (id, workshop_id, customer_id, rego)
       VALUES ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000c002', 'ZZZ999')`
    );

    const jwt = await loginViaApi(request);
    const res = await create(request, jwt, { customerName: "Our Customer", customerMobile: "0455 000 999", rego: "ZZZ999" });
    expect(res.status()).toBe(201);

    expect(await scalar("SELECT count(*) FROM customers WHERE mobile_e164 = '+61455000999'")).toBe("2");
    expect(await scalar("SELECT count(*) FROM vehicles WHERE rego = 'ZZZ999'")).toBe("2");
    expect(await scalar("SELECT name FROM customers WHERE id = '00000000-0000-0000-0000-00000000c002'")).toBe("Other Shop Customer");
    expect(await scalar("SELECT customer_id FROM vehicles WHERE id = '00000000-0000-0000-0000-00000000e002'")).toBe(
      "00000000-0000-0000-0000-00000000c002"
    );
  });

  test("ignores a workshopId in the body — the token decides", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await create(request, jwt, {
      customerName: "Sneaky",
      customerMobile: "0455 123 123",
      rego: "SNK1",
      workshopId: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(res.status()).toBe(201);
    expect(await scalar("SELECT workshop_id FROM jobs ORDER BY created_at DESC LIMIT 1")).toBe(SEED.workshopId);
  });

  test("a bad field returns 400 and leaves no orphan customer or vehicle", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await create(request, jwt, { customerName: "Valid Name", customerMobile: "0455 123 123", rego: "AB-12" });
    expect(res.status()).toBe(400);
    expect((await res.json()).field).toBe("rego");

    expect(await scalar("SELECT count(*) FROM customers")).toBe("1");
    expect(await scalar("SELECT count(*) FROM vehicles")).toBe("1");
    expect(await jobCount()).toBe("1");
  });

  test("the new job appears first in GET /api/jobs as not_started", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await create(request, jwt, { customerName: "List Check", customerMobile: "0455 321 321", rego: "LST1" });

    const res = await request.get(`${API_URL}/api/jobs`, { headers: { Authorization: `Bearer ${jwt}` } });
    const first = (await res.json()).jobs[0];
    expect(first).toMatchObject({ vehicleRego: "LST1", displayStatus: "not_started", customerName: "List Check" });
  });
});
