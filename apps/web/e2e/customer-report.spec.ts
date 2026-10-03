import { test, expect } from "@playwright/test";
import { resetDb, scalar, usePhotoKey } from "./helpers/db";
import { loginViaApi, sendReport } from "./helpers/api";
import { REAL_PHOTO_KEY, REAL_S3, SEED, TOTAL_CENTS, money } from "./helpers/fixtures";
import { gotoReady } from "./helpers/nav";


test.describe("Customer report", () => {
  test.beforeEach(async () => {
    await resetDb();
    if (REAL_S3) await usePhotoKey(SEED.brakeItemId, REAL_PHOTO_KEY);
  });

  test("a customer opens the link, approves some work and declines the rest", async ({ page, request, context }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    expect(report.totalCents).toBe(TOTAL_CENTS);
    expect(report.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Nothing from the mechanic's session should matter here.
    // Looking for JS and React problems — hydration mismatches, uncaught
    // throws. Failed resource loads are excluded on purpose: the seed's wiper
    // photo points at a key that doesn't exist, and WebKit logs that 404 to
    // the console while Chromium stays quiet. That the page survives a
    // missing photo is asserted directly further down.
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await test.step("opens with no session of any kind", async () => {
      await gotoReady(page, `/r/${report.token}`);
      await expect(page.getByRole("heading", { name: "Vehicle Health Report" })).toBeVisible();

      expect(await context.cookies()).toHaveLength(0);
      expect(await page.evaluate(() => localStorage.getItem("mp_token"))).toBeNull();
    });

    await test.step("shows who sent it and for which car", async () => {
      const header = page.locator("header");
      await expect(header).toContainText(SEED.workshopName);
      await expect(header).toContainText(SEED.vehicle);
      await expect(header).toContainText(SEED.rego);
    });

    await test.step("leads with the urgent item", async () => {
      await expect(page.getByText("1 item needs your attention")).toBeVisible();
    });

    await test.step("records the open exactly once, for time-to-open", async () => {
      expect(await scalar("SELECT count(*) FROM events WHERE type = 'report.opened'")).toBe("1");
    });

    await test.step("lists each inspection item with its note", async () => {
      const results = page.getByRole("list");
      await expect(results.locator("li")).toHaveCount(2);
      await expect(results.getByText(SEED.brakeTitle)).toBeVisible();
      await expect(results.getByText(SEED.wiperTitle)).toBeVisible();
      await expect(results.getByText(SEED.brakeNote)).toBeVisible();
    });

    await test.step("drops a photo it cannot load rather than showing a broken image", async () => {
      // The wiper item's seed key points at nothing, so its <img> must
      // disappear on error instead of leaving an icon mid-quote.
      const images = page.locator("img");
      await expect(images).toHaveCount(REAL_S3 ? 1 : 0);

      if (REAL_S3) {
        await expect
          .poll(() => images.first().evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 })
          .toBeGreaterThan(0);
      }
    });

    const submit = page.getByRole("button", { name: /Choose for every item|Send my decision/ });

    await test.step("will not submit until every item is answered and signed", async () => {
      await expect(submit).toBeDisabled();
      await expect(submit).toHaveText("Choose for every item");
      await expect(page.getByText(money(TOTAL_CENTS), { exact: false }).first()).toBeVisible();

      await page.getByRole("button", { name: "Approve all" }).click();
      await expect(submit).toHaveText("Send my decision");
      await expect(submit).toBeDisabled(); // still no name

      await page.getByLabel("Your name").fill(SEED.customerName);
      await expect(submit).toBeEnabled();
    });

    await test.step("shows a running subtotal once the choice differs from the quote", async () => {
      const wiperRow = page.locator("div.py-3", { hasText: SEED.wiperTitle });
      await wiperRow.getByRole("button", { name: "Decline" }).click();

      await expect(page.getByText(`Your selection: ${money(SEED.brakeCents)}`)).toBeVisible();
    });

    await test.step("submits and turns into a receipt", async () => {
      await submit.click();

      await expect(page.getByText(/you.re done/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`Thanks, ${SEED.customerName.split(" ")[0]}`)).toBeVisible();
      await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Declined", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Approved total")).toBeVisible();
    });

    await test.step("writes exactly what the customer chose, with an audit trail", async () => {
      expect(await scalar("SELECT count(*) FROM approvals")).toBe("2");
      expect(
        await scalar(
          `SELECT a.decision FROM approvals a
             JOIN report_items ri USING (report_id, inspection_item_id)
            WHERE ri.title = $1`,
          [SEED.brakeTitle]
        )
      ).toBe("approved");
      expect(
        await scalar(
          `SELECT a.decision FROM approvals a
             JOIN report_items ri USING (report_id, inspection_item_id)
            WHERE ri.title = $1`,
          [SEED.wiperTitle]
        )
      ).toBe("declined");

      expect(await scalar("SELECT DISTINCT signed_name FROM approvals")).toBe(SEED.customerName);
      expect(await scalar("SELECT count(*) FROM approvals WHERE ip_address IS NOT NULL")).toBe("2");
      expect(await scalar("SELECT count(*) FROM approvals WHERE user_agent IS NOT NULL")).toBe("2");

      expect(await scalar("SELECT status FROM jobs")).toBe("decided");
      expect(await scalar("SELECT decided_at IS NOT NULL FROM reports")).toBe("true");
    });

    await test.step("leaves a complete funnel in events", async () => {
      expect(await scalar("SELECT string_agg(type, ' -> ' ORDER BY id) FROM events")).toBe(
        "job.created -> report.sent -> report.opened -> approval.submitted"
      );
      // Only the approved item's price — what the shop is cleared to bill.
      expect(await scalar("SELECT payload->>'approvedTotalCents' FROM events WHERE type = 'approval.submitted'")).toBe(
        String(SEED.brakeCents)
      );
    });

    await test.step("stays decided across a reload, and counts only one open", async () => {
      await page.reload();
      await expect(page.getByText(/you.re done/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve all" })).toHaveCount(0);
      expect(await scalar("SELECT count(*) FROM events WHERE type = 'report.opened'")).toBe("1");
    });

    await test.step("never logged a console error along the way", () => {
      expect(consoleErrors).toEqual([]);
    });
  });

  test("approve-all leaves nothing declined", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    await gotoReady(page, `/r/${report.token}`);
    await page.getByRole("button", { name: "Approve all" }).click();
    await page.getByLabel("Your name").fill("Jo Bloggs");
    await page.getByRole("button", { name: "Send my decision" }).click();

    await expect(page.getByText(/you.re done/i)).toBeVisible({ timeout: 15_000 });
    expect(await scalar("SELECT count(*) FROM approvals WHERE decision = 'approved'")).toBe("2");
    expect(await scalar("SELECT count(*) FROM approvals WHERE decision = 'declined'")).toBe("0");
    expect(await scalar("SELECT payload->>'approvedTotalCents' FROM events WHERE type = 'approval.submitted'")).toBe(
      String(TOTAL_CENTS)
    );
  });

  test("a report covering one item only quotes that item", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt, SEED.jobId, [SEED.wiperItemId]);

    expect(report.totalCents).toBe(SEED.wiperCents);

    await gotoReady(page, `/r/${report.token}`);
    await expect(page.getByRole("list").locator("li")).toHaveCount(1);
    await expect(page.getByRole("list").getByText(SEED.wiperTitle)).toBeVisible();
    await expect(page.getByText(SEED.brakeTitle)).toHaveCount(0);
    // No red item, so the banner should not cry urgency.
    await expect(page.getByText("No urgent problems found")).toBeVisible();
  });
});
