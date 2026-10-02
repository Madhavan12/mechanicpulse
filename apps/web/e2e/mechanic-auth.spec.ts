import { test, expect } from "@playwright/test";
import { resetDb, scalar } from "./helpers/db";
import { SEED } from "./helpers/fixtures";

test.beforeAll(resetDb);

test.describe("Mechanic login", () => {
  test("rejects a wrong password without revealing whether the email exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(SEED.ownerEmail);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log In" }).click();

    // Scoped to the form: Next.js injects its own empty role="alert" route announcer.
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toHaveText("Wrong email or password.");
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("mp_token"))).toBeNull();
  });

  test("gives an unknown email the identical message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@demo.test");
    await page.getByLabel("Password").fill(SEED.password);
    await page.getByRole("button", { name: "Log In" }).click();

    // Byte-identical to the wrong-password case, so login can't be used to
    // enumerate which mechanic emails are real.
    await expect(page.locator('form [role="alert"]')).toHaveText("Wrong email or password.");
  });

  test("signs the mechanic in and lands on the job list", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(SEED.ownerEmail);
    await page.getByLabel("Password").fill(SEED.password);
    await page.getByRole("button", { name: "Log In" }).click();

    await page.waitForURL("**/jobs");

    const jwt = await page.evaluate(() => localStorage.getItem("mp_token"));
    expect(jwt?.split(".")).toHaveLength(3);
    expect(await scalar("SELECT last_login_at IS NOT NULL FROM mechanics WHERE email = $1", [SEED.ownerEmail])).toBe(
      "true"
    );
  });

  test("shows the seeded job as In Progress", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(SEED.ownerEmail);
    await page.getByLabel("Password").fill(SEED.password);
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForURL("**/jobs");

    // Scoped to the job card — "In Progress" is also a segmented-control
    // option in the desktop layout, which is in the DOM but hidden here.
    const card = page.locator("div.bg-card", { hasText: SEED.vehicle }).first();
    await expect(card).toBeVisible();
    // The card renders both the mobile and desktop layouts; only one is
    // visible at a given width, but both are in the DOM.
    await expect(card.getByText("In Progress").first()).toBeVisible();
    await expect(card.getByText(SEED.customerName).first()).toBeVisible();
  });

  test("sends an unauthenticated visitor from /jobs back to /login", async ({ page }) => {
    await page.goto("/jobs");
    await page.waitForURL("**/login");
    await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
  });
});
