import { test, expect, type Page } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, loginViaUi, sendReport } from "./helpers/api";
import { API_URL, SEED } from "./helpers/fixtures";
import { gotoReady } from "./helpers/nav";

/** These run against the console SMS provider (the default when Twilio isn't
 * configured): it logs instead of sending, so the suite can check what would
 * have been texted without a phone or a Twilio account. The real Twilio
 * adapter is covered by unit tests against a fake fetch, plus a manual check
 * with a real phone — see docs/test-cases.md. */

test.beforeEach(resetDb);

const dialog = (page: Page) => page.getByRole("dialog");

async function openSeedJob(page: Page) {
  await loginViaUi(page);
  await gotoReady(page, `/jobs/${SEED.jobId}`);
  await expect(page.getByRole("heading", { name: /Toyota Corolla — ABC123/ })).toBeVisible();
}

async function sendFromUi(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Send Report to Customer" }).click();
  await dialog(page).getByRole("button", { name: "Send Report" }).click();
  return dialog(page).getByLabel("Report link").inputValue();
}

test.describe("Texting the report link", () => {
  test("sending a report texts the customer the link, says so, and records the message", async ({ page }) => {
    await openSeedJob(page);
    const url = await sendFromUi(page);

    await expect(dialog(page).getByRole("heading", { name: "Text sent to Alex" })).toBeVisible();

    const sms = await query<{ to_e164: string; body: string; provider: string; status: string; provider_message_id: string }>(
      "SELECT to_e164, body, provider, status, provider_message_id FROM sms_messages"
    );
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ to_e164: "+61412345678", provider: "console", status: "sent" });
    expect(sms[0].provider_message_id).toMatch(/^console-/);
    // The text carries the very link the mechanic is shown, the workshop and the count.
    expect(sms[0].body).toContain(url);
    expect(sms[0].body).toContain(SEED.workshopName);
    expect(sms[0].body).toContain("2 items on your Toyota Corolla");

    expect(await scalar("SELECT count(*) FROM events WHERE type = 'sms.sent'")).toBe("1");
    expect(await scalar("SELECT actor::text FROM events WHERE type = 'sms.sent'")).toBe("system");
  });

  test("the report status card shows the text after the dialog is closed, and survives a reload", async ({ page }) => {
    await openSeedJob(page);
    await sendFromUi(page);
    await dialog(page).getByRole("button", { name: "Done" }).click();

    const card = page.getByRole("region", { name: "Report status" });
    await expect(card).toContainText("Waiting for the customer");
    await expect(card.getByTestId("text-status")).toHaveText("Text sent");

    await page.reload();
    await expect(page.getByRole("region", { name: "Report status" }).getByTestId("text-status")).toHaveText("Text sent");
  });

  test("a customer who opted out is not texted, and the mechanic is told to pass the link on", async ({ page }) => {
    await query("UPDATE customers SET sms_opted_out_at = now() WHERE name = $1", [SEED.customerName]);
    await openSeedJob(page);
    const url = await sendFromUi(page);

    await expect(dialog(page).getByRole("heading", { name: "Alex has opted out of texts" })).toBeVisible();
    await expect(dialog(page).getByRole("alert")).toContainText("won't be shown again");
    // The link is still there to pass on by hand.
    expect(url).toMatch(/\/r\/[A-Za-z0-9_-]{20,}$/);

    expect(await scalar("SELECT count(*) FROM sms_messages")).toBe("0");
    // The report itself is unaffected.
    expect(await scalar("SELECT status FROM jobs WHERE id = $1", [SEED.jobId])).toBe("sent");

    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("text-status")).toHaveText("Not texted — customer opted out");
  });
});

test.describe("Send a new link", () => {
  test("revokes the old link, texts a new one, and the customer sees the same quote", async ({ page, context }) => {
    await openSeedJob(page);
    const oldUrl = await sendFromUi(page);
    await dialog(page).getByRole("button", { name: "Done" }).click();

    // Cancel changes nothing.
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByText("The old link will stop working.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await scalar("SELECT count(*) FROM reports")).toBe("1");

    await page.getByRole("button", { name: "Send a new link" }).click();
    await page.getByRole("button", { name: "Send new link" }).click();

    const newUrl = await dialog(page).getByLabel("Report link").inputValue();
    expect(newUrl).not.toBe(oldUrl);
    await expect(dialog(page).getByRole("heading", { name: "Text sent to Alex" })).toBeVisible();

    // Two texts now, the second carrying the new link.
    const bodies = await query<{ body: string }>("SELECT body FROM sms_messages ORDER BY created_at");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].body).toContain(newUrl);

    // Old report revoked, new one live, same frozen findings, same total.
    expect(await scalar("SELECT count(*) FROM reports WHERE revoked_at IS NOT NULL")).toBe("1");
    expect(await scalar("SELECT count(*) FROM reports WHERE revoked_at IS NULL AND decided_at IS NULL")).toBe("1");
    expect(await scalar("SELECT count(DISTINCT total_cents) FROM reports")).toBe("1");
    expect(
      await scalar(
        `SELECT count(*) FROM report_items WHERE report_id = (SELECT id FROM reports WHERE revoked_at IS NULL)`
      )
    ).toBe("2");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'report.revoked'")).toBe("1");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'report.sent'")).toBe("2");

    const customer = await context.newPage();
    await customer.goto(oldUrl);
    await expect(customer.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await customer.goto(newUrl);
    await expect(customer.getByText(SEED.brakeTitle).first()).toBeVisible();
    await expect(customer.getByText(SEED.wiperTitle).first()).toBeVisible();
    await customer.close();

    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("text-status")).toHaveText("Text sent");
  });

  test("is not offered once the customer has responded, and the API refuses", async ({ page, request }) => {
    const jwt = await loginViaApi(request);
    const report = await sendReport(request, jwt);
    const decision = await request.post(`${API_URL}/api/report/${report.token}/decision`, {
      data: {
        signedName: "Alex Customer",
        decisions: [
          { itemId: SEED.brakeItemId, decision: "approved" },
          { itemId: SEED.wiperItemId, decision: "declined" },
        ],
      },
    });
    expect(decision.status()).toBe(200);

    await openSeedJob(page);
    await expect(page.getByRole("region", { name: "Report status" })).toContainText("Customer has responded");
    await expect(page.getByRole("button", { name: "Send a new link" })).toHaveCount(0);

    const res = await request.post(`${API_URL}/api/jobs/${SEED.jobId}/report/resend`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("already_decided");
    expect(await scalar("SELECT count(*) FROM reports")).toBe("1");
  });

  test("an unsent job has nothing to resend", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await request.post(`${API_URL}/api/jobs/${SEED.jobId}/report/resend`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("no_report");
  });

  test("an unknown or foreign job id is a 404", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);
    const res = await request.post(`${API_URL}/api/jobs/00000000-0000-0000-0000-00000000bfff/report/resend`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Delivery webhook", () => {
  test("refuses an unsigned or wrongly signed callback and changes nothing", async ({ request }) => {
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);
    const id = await scalar("SELECT provider_message_id FROM sms_messages");

    for (const headers of [{}, { "X-Twilio-Signature": "AAAA" }] as Record<string, string>[]) {
      const res = await request.post(`${API_URL}/api/sms/twilio/status`, {
        headers,
        form: { MessageSid: id ?? "x", MessageStatus: "delivered" },
      });
      expect(res.status()).toBe(403);
    }
    expect(await scalar("SELECT status::text FROM sms_messages")).toBe("sent");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'sms.delivered'")).toBe("0");
  });
});
