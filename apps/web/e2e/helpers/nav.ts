import type { Page } from "@playwright/test";

/** Navigate, then wait until the page is actually interactive.
 *
 * Why this exists: these pages are client components with controlled inputs.
 * Typing into one between first paint and hydration is lost — React mounts,
 * re-renders from its own (empty) state, and the typed value disappears. It
 * surfaced as an empty Email box under WebKit, which hydrates a little later
 * than Chromium here, so the form then failed its `required` check and never
 * submitted at all.
 *
 * Any test that types into a field should navigate through this, not a bare
 * page.goto(). */
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
