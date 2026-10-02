import { test, expect } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, sendReport } from "./helpers/api";
import { API_URL, SEED } from "./helpers/fixtures";

test.beforeEach(resetDb);

/** A dead link must say so plainly and show nothing priced. The customer is
 * on a phone, possibly days later, and the only useful next step is a call. */
async function expectDeadEnd(page: import("@playwright/test").Page, heading: string) {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$");
}

test.describe("Report lifecycle", () => {
  test("a token that was never issued is simply invalid", async ({ page }) => {
    await page.goto("/r/this-token-never-existed");
    await expectDeadEnd(page, "This link isn't valid");
  });

  test("an expired link explains itself and offers the phone", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    // sent_at moves too: the schema's CHECK (expires_at > sent_at) refuses an
    // expiry before the send, which is worth knowing — it won't store nonsense.
    await query(
      `UPDATE reports SET sent_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        WHERE id = $1`,
      [report.reportId]
    );

    await page.goto(`/r/${report.token}`);
    await expectDeadEnd(page, "This link has expired");
    await expect(page.getByRole("link")).toHaveAttribute("href", `tel:${SEED.workshopPhone}`);
  });

  test("a revoked link cannot be read or approved", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    await query(`UPDATE reports SET revoked_at = now() WHERE id = $1`, [report.reportId]);

    await page.goto(`/r/${report.token}`);
    await expectDeadEnd(page, "This report was withdrawn");

    const res = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: {
        signedName: "Someone",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "approved" },
          { itemId: SEED.wiperItemId, decision: "approved" },
        ],
      },
    });
    expect(res.status()).toBe(410);
    expect(await scalar("SELECT count(*) FROM approvals")).toBe("0");
  });

  test("a job can only have one live report at a time", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);

    const second = await request.post(`${API_URL}/api/jobs/${SEED.jobId}/report`, {
      headers: { Authorization: `Bearer ${jwt}` },
      data: {},
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).error).toBe("report_already_live");
    expect(await scalar("SELECT count(*) FROM reports")).toBe("1");
  });

  test("a revised quote is allowed once the first was decided", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const first = await sendReport(request, jwt);

    await request.post(`${API_URL}/api/report/${first.token}/decision`, {
      data: {
        signedName: "Alex Customer",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "declined" },
          { itemId: SEED.wiperItemId, decision: "declined" },
        ],
      },
    });

    // Declining everything isn't the end of the conversation — the shop can
    // re-quote, and that's a new report, not an edit of the old one.
    const second = await sendReport(request, jwt);
    expect(second.token).not.toBe(first.token);
    expect(await scalar("SELECT count(*) FROM reports")).toBe("2");
  });

  test("the earlier report keeps its own frozen snapshot", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const first = await sendReport(request, jwt);

    await request.post(`${API_URL}/api/report/${first.token}/decision`, {
      data: {
        signedName: "Alex Customer",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "approved" },
          { itemId: SEED.wiperItemId, decision: "declined" },
        ],
      },
    });

    // The mechanic puts the price up afterwards.
    await query(`UPDATE inspection_items SET price_cents = 99900 WHERE id = $1`, [SEED.brakeItemId]);

    // What the customer agreed to must not move with it.
    expect(
      await scalar(`SELECT price_cents FROM report_items WHERE inspection_item_id = $1`, [SEED.brakeItemId])
    ).toBe(String(SEED.brakeCents));
  });

  test("a decided report cannot be submitted twice", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);
    const decisions = [
      { itemId: SEED.brakeItemId, decision: "approved" },
      { itemId: SEED.wiperItemId, decision: "approved" },
    ];

    const first = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: { signedName: "Alex Customer", decisions },
    });
    expect(first.status()).toBe(200);

    const again = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: { signedName: "Someone Else", decisions: decisions.map((d) => ({ ...d, decision: "declined" })) },
    });
    expect(again.status()).toBe(409);
    expect(await scalar("SELECT count(*) FROM approvals")).toBe("2");
    expect(await scalar("SELECT DISTINCT signed_name FROM approvals")).toBe("Alex Customer");
  });

  test("a partial submission is refused — every item needs an answer", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    const res = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: { signedName: "Alex Customer", decisions: [{ itemId: SEED.brakeItemId, decision: "approved" }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("incomplete");
    expect(await scalar("SELECT count(*) FROM approvals")).toBe("0");
  });

  test("a blank signature is refused", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);

    const res = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: {
        signedName: "   ",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "approved" },
          { itemId: SEED.wiperItemId, decision: "approved" },
        ],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("name_required");
  });
});
