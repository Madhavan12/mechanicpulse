import { test, expect, type Page } from "@playwright/test";
import { resetDb, query, scalar } from "./helpers/db";
import { loginViaApi, loginViaUi, sendReport } from "./helpers/api";
import { API_URL, money, REAL_S3, SEED, TOTAL_CENTS } from "./helpers/fixtures";
import { gotoReady } from "./helpers/nav";

test.beforeEach(resetDb);

/** A real 1x1 PNG. The page compresses it through a canvas like any photo. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const photo = (name = "part.png") => ({ name, mimeType: "image/png", buffer: PNG });

const dialog = (page: Page) => page.getByRole("dialog");
const photoInput = (page: Page) => dialog(page).getByTestId("photo-input");

async function openSeedJob(page: Page) {
  await loginViaUi(page);
  await gotoReady(page, `/jobs/${SEED.jobId}`);
  await expect(page.getByRole("heading", { name: /Toyota Corolla — ABC123/ })).toBeVisible();
}

async function openBrakeFinding(page: Page) {
  await openSeedJob(page);
  await page.getByText(SEED.brakeTitle).first().click();
  await expect(dialog(page)).toBeVisible();
}

/** Lets the browser's PUT "succeed" without a real bucket. The server-side
 * confirm still checks S3 for real, so without credentials the upload ends
 * in the Failed/Retry state — which is the path these tests want. */
async function stubS3Put(page: Page, hold?: Promise<void>) {
  await page.route(/amazonaws\.com/, async (route) => {
    if (hold) await hold;
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  });
}

async function addReadyPhotos(itemId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await query(
      `INSERT INTO media (inspection_item_id, storage_key, content_type, state, bytes, uploaded_at, position)
       VALUES ($1, $2, 'image/webp', 'ready', 1000, now(), $3)`,
      [itemId, `${SEED.workshopId}/2026-11-02/seed-${itemId.slice(-4)}-${i}.webp`, i]
    );
  }
}

/** The seed gives each finding one ready photo. These tests count photos
 * exactly, so they start from none. */
const clearPhotos = () => query("DELETE FROM media");

test.describe("Photos on a finding", () => {
  test.beforeEach(clearPhotos);

  test("shows a finding's existing photos in the list and the form, and removes one on request", async ({ page }) => {
    await addReadyPhotos(SEED.brakeItemId, 2);
    await openSeedJob(page);

    const bar = page.locator("div.bg-card", { hasText: SEED.brakeTitle }).first();
    await expect(bar.getByText("2 photos")).toBeVisible();

    await bar.click();
    await expect(dialog(page).getByText("Photos (2/4)")).toBeVisible();
    await expect(dialog(page).getByRole("img", { name: "Finding photo" })).toHaveCount(2);

    await dialog(page).getByRole("button", { name: "Remove photo" }).first().click();
    await expect(dialog(page).getByText("Photos (1/4)")).toBeVisible();
    expect(await scalar("SELECT count(*) FROM media WHERE inspection_item_id = $1", [SEED.brakeItemId])).toBe("1");
  });

  test("at four photos the Add Photo control is disabled and says why", async ({ page }) => {
    await addReadyPhotos(SEED.brakeItemId, 4);
    await openBrakeFinding(page);

    await expect(dialog(page).getByText("Photos (4/4)")).toBeVisible();
    await expect(photoInput(page)).toBeDisabled();
    await expect(dialog(page).getByText(/most photos a finding can have/)).toBeVisible();
  });

  test("choosing a photo on a brand-new finding saves the finding first", async ({ page }) => {
    await stubS3Put(page);
    await openSeedJob(page);
    await page.getByRole("button", { name: "+ Add Finding" }).click();

    // Photo before the finding is valid: nothing saved, the errors say why.
    await photoInput(page).setInputFiles(photo());
    await expect(dialog(page).getByText("Enter a title for this finding.")).toBeVisible();
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");

    await dialog(page).getByLabel("Title").fill("Cracked CV boot");
    await dialog(page).getByRole("radio", { name: "Monitor" }).click();
    await dialog(page).getByLabel("Price ($)").fill("95");
    await photoInput(page).setInputFiles(photo());

    // The finding exists now, even though the photo's fate is still open.
    await expect.poll(() => scalar("SELECT count(*) FROM inspection_items WHERE title = 'Cracked CV boot'")).toBe("1");
    await expect(page.getByText("Cracked CV boot").first()).toBeVisible();
    // The form is now editing it: Cancel became Close, and Delete is offered.
    await expect(dialog(page).getByRole("button", { name: "Close" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Delete finding" })).toBeVisible();
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'item.added'")).toBe("1");
  });

  test("a failed upload shows Failed with Retry, keeps the finding, and is recorded", async ({ page }) => {
    // Without real S3 the server-side confirm can't find the object, which is
    // exactly the "PUT looked fine but the photo isn't there" failure.
    test.skip(REAL_S3, "this path needs the object to be missing");
    await stubS3Put(page);
    await openBrakeFinding(page);
    await photoInput(page).setInputFiles(photo());

    const failed = dialog(page).locator('li[data-state="failed"]');
    await expect(failed).toBeVisible();
    await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(dialog(page).getByText("Photos (1/4)")).toBeVisible(); // the failed one still holds its slot on screen

    await expect.poll(() => scalar("SELECT state FROM media WHERE inspection_item_id = $1", [SEED.brakeItemId])).toBe("failed");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'media.upload_started'")).toBe("1");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'media.upload_failed'")).toBe("1");
    // Nothing leaked onto the finding or into a report.
    expect(await scalar("SELECT count(*) FROM media WHERE state = 'ready'")).toBe("0");
    expect(await scalar("SELECT count(*) FROM inspection_items")).toBe("2");

    // Dismissing frees the slot; the dialog can now close.
    await failed.getByRole("button", { name: "Dismiss failed photo" }).click();
    await expect(dialog(page).getByText("Photos (0/4)")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
  });

  test("the form can't be closed or saved while a photo is uploading", async ({ page }) => {
    test.skip(REAL_S3, "needs the PUT to stall");
    let release!: () => void;
    await stubS3Put(page, new Promise<void>((r) => (release = r)));
    await openBrakeFinding(page);
    await photoInput(page).setInputFiles(photo());

    await expect(dialog(page).getByText(/Uploading — keep this open/)).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(photoInput(page)).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();

    release();
    await expect(dialog(page).locator('li[data-state="failed"]')).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  test("a successful upload ends with a real thumbnail and a ready media row", async ({ page }) => {
    test.skip(!REAL_S3, "needs real S3 credentials: run with E2E_REAL_S3=1 after `aws sso login`");
    await openBrakeFinding(page);
    await photoInput(page).setInputFiles(photo());

    await expect(dialog(page).getByRole("img", { name: "Finding photo" })).toHaveCount(1, { timeout: 20_000 });
    await expect(dialog(page).locator('li[data-state="failed"]')).toHaveCount(0);
    expect(await scalar("SELECT state FROM media WHERE inspection_item_id = $1", [SEED.brakeItemId])).toBe("ready");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'media.upload_succeeded'")).toBe("1");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("div.bg-card", { hasText: SEED.brakeTitle }).first().getByText("1 photo")).toBeVisible();
  });
});

test.describe("Media API against a real database", () => {
  test.beforeEach(clearPhotos);
  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
  const presignBody = (itemId: string = SEED.brakeItemId) => ({ inspectionItemId: itemId, contentType: "image/webp", bytes: 5000 });

  test("every endpoint requires authentication", async ({ request }) => {
    expect((await request.post(`${API_URL}/api/media/presign`, { data: presignBody() })).status()).toBe(401);
    const id = "00000000-0000-0000-0000-0000000f0001";
    expect((await request.post(`${API_URL}/api/media/${id}/confirm`, { data: {} })).status()).toBe(401);
    expect((await request.post(`${API_URL}/api/media/${id}/fail`, { data: {} })).status()).toBe(401);
    expect((await request.delete(`${API_URL}/api/media/${id}`)).status()).toBe(401);
  });

  test("presign records a pending row and a started event", async ({ request }) => {
    const jwt = await loginViaApi(request);
    const res = await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() });
    expect(res.status()).toBe(200);
    const { mediaId, storageKey } = await res.json();

    const row = await query<{ state: string; storage_key: string; bytes: number }>(
      "SELECT state, storage_key, bytes FROM media WHERE id = $1",
      [mediaId]
    );
    expect(row[0]).toMatchObject({ state: "pending", storage_key: storageKey, bytes: 5000 });
    expect(storageKey.startsWith(`${SEED.workshopId}/`)).toBe(true);
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'media.upload_started'")).toBe("1");
  });

  test("the fifth photo is refused", async ({ request }) => {
    await addReadyPhotos(SEED.brakeItemId, 4);
    const jwt = await loginViaApi(request);
    const res = await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("photo_limit");
    expect(await scalar("SELECT count(*) FROM media")).toBe("4");
  });

  test("failed and abandoned uploads don't hold a slot, so the mechanic can always retry", async ({ request }) => {
    await addReadyPhotos(SEED.brakeItemId, 3);
    await query(
      `INSERT INTO media (inspection_item_id, storage_key, content_type, state, bytes, position)
       VALUES ($1, 'k/failed.webp', 'image/webp', 'failed', 10, 3),
              ($1, 'k/stale.webp',  'image/webp', 'pending', 10, 4)`,
      [SEED.brakeItemId]
    );
    await query("UPDATE media SET created_at = now() - interval '1 hour' WHERE storage_key = 'k/stale.webp'");
    const jwt = await loginViaApi(request);
    const res = await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() });
    expect(res.status()).toBe(200);
  });

  test("a finding in another workshop can't be given a photo, and a photo id from elsewhere can't be touched", async ({ request }) => {
    const W = "00000000-0000-0000-0000-000000000002";
    await query(`INSERT INTO workshops (id, name, phone_e164, sms_sender_id, timezone) VALUES ($1, 'Other', '+61390000001', 'Other', 'Australia/Sydney')`, [W]);
    await query(
      `INSERT INTO mechanics (id, workshop_id, name, email, password_hash, role)
       SELECT '00000000-0000-0000-0000-00000000a0ff', $1, 'M', 'o@o.test', password_hash, 'owner' FROM mechanics WHERE email = 'owner@demo.test'`,
      [W]
    );
    await query(`INSERT INTO customers (id, workshop_id, name, mobile_e164) VALUES ('00000000-0000-0000-0000-00000000c0ff', $1, 'C', '+61455000001')`, [W]);
    await query(`INSERT INTO vehicles (id, workshop_id, customer_id, rego) VALUES ('00000000-0000-0000-0000-00000000e0ff', $1, '00000000-0000-0000-0000-00000000c0ff', 'OTH1')`, [W]);
    await query(
      `INSERT INTO jobs (id, workshop_id, vehicle_id, customer_id, created_by)
       VALUES ('00000000-0000-0000-0000-00000000b0ff', $1, '00000000-0000-0000-0000-00000000e0ff', '00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-00000000a0ff')`,
      [W]
    );
    await query(`INSERT INTO inspection_items (id, job_id, title, severity, price_cents) VALUES ('00000000-0000-0000-0000-00000000d0ff', '00000000-0000-0000-0000-00000000b0ff', 'Theirs', 'red', 1)`);
    await addReadyPhotos("00000000-0000-0000-0000-00000000d0ff", 1);
    const theirMedia = (await query<{ id: string }>("SELECT id FROM media LIMIT 1"))[0].id;

    const jwt = await loginViaApi(request);
    const res = await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody("00000000-0000-0000-0000-00000000d0ff") });
    expect(res.status()).toBe(404);
    expect((await request.post(`${API_URL}/api/media/${theirMedia}/confirm`, { headers: auth(jwt), data: {} })).status()).toBe(404);
    expect((await request.post(`${API_URL}/api/media/${theirMedia}/fail`, { headers: auth(jwt), data: {} })).status()).toBe(404);
    expect((await request.delete(`${API_URL}/api/media/${theirMedia}`, { headers: auth(jwt) })).status()).toBe(404);
    expect(await scalar("SELECT count(*) FROM media WHERE id = $1", [theirMedia])).toBe("1");
  });

  test("confirm refuses a photo whose object isn't in S3 and leaves the row pending", async ({ request }) => {
    test.skip(REAL_S3, "a real bucket may legitimately hold the key");
    const jwt = await loginViaApi(request);
    const { mediaId } = await (await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() })).json();

    const res = await request.post(`${API_URL}/api/media/${mediaId}/confirm`, { headers: auth(jwt), data: { width: 10, height: 10 } });
    expect([409, 502]).toContain(res.status()); // not uploaded / storage unreachable — never 200
    expect(await scalar("SELECT state FROM media WHERE id = $1", [mediaId])).toBe("pending");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'media.upload_succeeded'")).toBe("0");
  });

  test("a sent job refuses new photos and photo removal", async ({ request }) => {
    await addReadyPhotos(SEED.brakeItemId, 1);
    const mediaId = (await query<{ id: string }>("SELECT id FROM media LIMIT 1"))[0].id;
    const jwt = await loginViaApi(request);
    await sendReport(request, jwt);

    const presign = await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() });
    expect(presign.status()).toBe(409);
    expect((await request.delete(`${API_URL}/api/media/${mediaId}`, { headers: auth(jwt) })).status()).toBe(409);
    expect(await scalar("SELECT count(*) FROM media WHERE id = $1", [mediaId])).toBe("1");
  });

  test("the fail endpoint marks a pending upload failed, and never downgrades a finished one", async ({ request }) => {
    await addReadyPhotos(SEED.brakeItemId, 1);
    const readyId = (await query<{ id: string }>("SELECT id FROM media LIMIT 1"))[0].id;
    const jwt = await loginViaApi(request);
    const { mediaId } = await (await request.post(`${API_URL}/api/media/presign`, { headers: auth(jwt), data: presignBody() })).json();

    expect((await request.post(`${API_URL}/api/media/${mediaId}/fail`, { headers: auth(jwt), data: { reason: "Network dropped" } })).status()).toBe(204);
    expect(await scalar("SELECT state FROM media WHERE id = $1", [mediaId])).toBe("failed");

    expect((await request.post(`${API_URL}/api/media/${readyId}/fail`, { headers: auth(jwt), data: {} })).status()).toBe(204);
    expect(await scalar("SELECT state FROM media WHERE id = $1", [readyId])).toBe("ready");
  });
});

test.describe("Send Report", () => {
  test("is disabled with no findings", async ({ page }) => {
    await loginViaUi(page);
    await gotoReady(page, "/jobs/new");
    await page.getByLabel("Name").fill("Pat New");
    await page.getByLabel("Mobile").fill("0455 777 888");
    await page.getByLabel("Rego").fill("NEW123");
    await page.getByRole("button", { name: "Create Job" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);

    await expect(page.getByRole("button", { name: "Send Report to Customer" })).toBeDisabled();
    await expect(page.getByText("Add at least one finding to send a report.")).toBeVisible();
  });

  test("asks first, then shows the link once, and the customer sees what the mechanic built", async ({ page, context }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "Send Report to Customer" }).click();

    // Cancel changes nothing.
    await expect(dialog(page).getByText(/2 findings, \$334\.00 total, for Alex Customer/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    expect(await scalar("SELECT status FROM jobs WHERE id = $1", [SEED.jobId])).toBe("open");
    expect(await scalar("SELECT count(*) FROM reports")).toBe("0");

    await page.getByRole("button", { name: "Send Report to Customer" }).click();
    await dialog(page).getByRole("button", { name: "Send Report" }).click();

    const link = dialog(page).getByLabel("Report link");
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    expect(url).toMatch(/\/r\/[A-Za-z0-9_-]{20,}$/);
    await expect(dialog(page).getByText(/won't be shown again/)).toBeVisible();
    await expect(dialog(page).getByRole("link", { name: "Text it to Alex" })).toHaveAttribute("href", /^sms:\+61412345678\?&body=.+%2Fr%2F/);

    // The customer opens that exact link.
    const customer = await context.newPage();
    await customer.goto(url);
    await expect(customer.getByText(SEED.brakeTitle).first()).toBeVisible();
    await expect(customer.getByText(SEED.wiperTitle).first()).toBeVisible();
    await expect(customer.locator("body")).toContainText(money(TOTAL_CENTS));
    await customer.close();

    // Done closes it for good: the job is read-only and the link can't be brought back.
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText(/has been sent to the customer/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send Report to Customer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add Finding" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/has been sent to the customer/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(url);

    expect(await scalar("SELECT status FROM jobs WHERE id = $1", [SEED.jobId])).toBe("sent");
    expect(await scalar("SELECT count(*) FROM events WHERE type = 'report.sent'")).toBe("1");
  });

  test("a sent job's list status becomes Completed", async ({ page }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "Send Report to Customer" }).click();
    await dialog(page).getByRole("button", { name: "Send Report" }).click();
    await dialog(page).getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "‹ Jobs" }).click();
    await page.waitForURL("**/jobs");
    const card = page.locator("div.bg-card", { hasText: SEED.vehicle }).first();
    await expect(card.getByText("Completed").first()).toBeVisible();
  });

  test("shows the server's message if the send is refused", async ({ page, request }) => {
    await openSeedJob(page);
    await page.getByRole("button", { name: "Send Report to Customer" }).click();

    // Someone else sends it first (another tab, another device).
    await sendReport(request, await loginViaApi(request));

    await dialog(page).getByRole("button", { name: "Send Report" }).click();
    await expect(dialog(page).getByRole("alert")).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
