# Mechanic Pulse — Frontend Build Spec

Source: [Figma wireframes](https://www.figma.com/design/4Osws3ZxuC6IWL1fFHA2G6/Mechanic-Pulse---Wireframes)

Paste this whole file into a Claude Code session (or reference it in CLAUDE.md) as the spec to build the frontend from. Everything below reflects exactly what's in the Figma file — colors, spacing, structure, and the click-through flow.

## 1. What this product is

Mechanic Pulse is a workshop tool with three surfaces:
- **Mechanic app** — used in-shop by the technician, on a desktop at the service bay and on mobile when away from the counter. Covers Login, Job List, Active Job.
- **Customer report** — a mobile-only page a customer opens from a link after their car's inspection. No desktop version exists by design.
- **Home** — a public marketing/landing page (desktop + mobile), separate from the authenticated app.

There's no backend in the wireframes — this is UI/layout only. Treat icons, the hero's `[ App screenshot ]` placeholder, and photo upload as TODOs.

## 2. Design tokens

### Colors
```css
--color-ink:     #090805;  /* primary text, dark headers/nav, CTA bands */
--color-surface: #e8daa6;  /* page background (cream) — most screens sit on this */
--color-card:    #fffdf7;  /* card / list-bar background, sits on surface */
--color-border:  #d3c093;  /* dividers, input borders, inactive segmented-control track */
--color-brass:   #6c5c0b;  /* primary brand/action color — buttons, links, secondary text */
--color-amber:   #f1b22a;  /* status: Monitor / In Progress (fill only — fails contrast as text on light bg) */
--color-red:     #cf0000;  /* status: Urgent / Needs Attention — use sparingly */
--color-green:   #4c7a3d;  /* status: Good / Completed */
--color-white:   #ffffff;  /* text on dark or colored fills */
```

### Typography
Inter — Regular / Medium / Semi Bold / Bold.
- Headlines: 22–40px Bold
- Section titles: 15–26px Semi Bold
- Body: 13–16px Regular/Medium
- Captions/labels/chips: 11–13px

### Shape
- Buttons, inputs, small controls: 8px radius
- Cards, panels: 12–16px radius
- List-item "bars" (see below): 14px radius
- Pills, segmented-control track, avatars: 999px (fully round)
- Every rounded element uses iOS-style continuous corner smoothing (~0.6) — a nice-to-have for web, skip it if your CSS doesn't support `corner-shape`/squircle without extra libraries.

### Spacing
- Section padding: 20px (mobile) / 32–48px (desktop)
- Gap between list bars: 10px
- Minimum interactive tap target on mobile: 44px height
- Fixed mobile footers get 34px bottom padding (iOS safe-area / home-indicator clearance)

## 3. The core reusable pattern: "list bars"

Across Job List, Active Job's checklist, and the Customer Report's inspection results, the same pattern repeats: **each list item is its own rounded white card (`--color-card`, 14px radius) floating on the cream (`--color-surface`) section background, with a 10px gap between items** — not a single bordered table with divider lines. Build this once as a shared component.

Exception: the "Parts & Labor" / "Recommended Work & Estimate" cost breakdowns use plain flat dividers, not bars — that's a receipt-style subtotal list, intentionally different since the rows sum to a total rather than being independent tappable items.

## 4. Screens

### Home (Desktop 1280px / Mobile 390px)
Public page, not part of the authenticated app — give it its own route (e.g. `/`).
- **Nav**: logo "Mechanic Pulse" + links (Features / How it works / Contact) + "Log In" button, right-aligned (desktop); logo + hamburger icon (mobile)
- **Hero**: headline ("Vehicle health reports your customers actually trust"), subhead, two CTAs — "Get Started" (primary) and "See How It Works" (outline) — plus a screenshot placeholder box
- **Features**: 3 cards (icon circle, title, 1–2 line description) — 3-column grid on desktop, stacked on mobile
- **How it works**: 3 numbered steps (same responsive pattern as Features)
- **CTA band**: full-bleed dark (`--color-ink`) section, headline + "Get Started Free" button
- **Footer**: brand name + copyright, inline on desktop, stacked/centered on mobile

### Login (Desktop 1280px / Mobile 390px)
- Desktop: a 400px card centered on the cream page
- Mobile: same content, no card chrome — fields sit flush on the page, top-aligned with generous top padding instead of vertical centering
- Content: "Mechanic Pulse" + subtitle, Email field, Password field (44px input height, label above), "Forgot password?" link, full-width primary "Log In" button
- **Action**: Log In → navigates to Job List

### Job List (Desktop 1280px / Mobile 390px)
- **Header** (`--color-ink` bg): brand name, "On Shift" amber pill, mechanic name + bay
- **Title row**: "Today's Jobs (N)" + a true **segmented control** (single rounded track, one highlighted active segment — not separate pill buttons). Desktop segments: All / Not Started / In Progress / Completed. Mobile: All / Active / Done.
- **"+ New Job" button** — not in the original Figma wireframes, added here once a real Create Job flow became necessary. Sits in the title row, right of the segmented control. Labelled (not icon-only) for clarity, primary (brass fill) variant, minimum 44px tap target. Opens Create Job (`/jobs/new`).
- **List** (the list-bar pattern): one bar per job.
  - Desktop: single-line row — vehicle name + customer/bay on the left, status pill + "Open" button on the right
  - Mobile: stacked card — status pill on top, vehicle name, then customer/bay + "Open" button below
  - Status pill variants: amber fill = In Progress, green fill = Completed, outlined = Not Started
  - **Status mapping note**: the wireframes don't define how pill status derives from backend data. Implemented mapping (not from Figma, flagged in `docs/test-cases.md`): job status `open` with no inspection items → Not Started; `open` with ≥1 inspection item → In Progress; `sent`/`decided`/`closed` → Completed.
- **Action**: "Open" on a job → navigates to Active Job

### Create Job (Desktop 1280px / Mobile 390px)
Not in the original Figma wireframes — spec'd here from the data model. Mobile-first: a mechanic fills this in standing at the car.
- **Header**: same pattern as Active Job (mobile: back chevron "‹ Jobs").
- **Single-column form**, 44px inputs, label above (desktop: centered card ~480px, like Login). Two groups:
  - **Customer** — Name (required), Mobile (required; Australian number typed as `0412 345 678` or `+61…`, stored E.164)
  - **Vehicle** — Rego (required; shown upper-case, stored without spaces), Make, Model (optional), Odometer km (optional)
- **Footer**: full-width primary "Create Job" + outline "Cancel" (back to Job List). Mobile has the 34px safe-area bottom padding.
- **Validation**: inline, per field, on submit; the server re-validates everything and its messages are shown if it disagrees.
- **Repeat customers/vehicles**: a mobile or rego the workshop has seen before is reused, not duplicated (the schema is unique on both).
- **Action**: Create Job → the new job's Active Job page (`/jobs/[id]`).
- **Out of scope for now**: customer/rego lookup or autocomplete, VIN, year, photos (those belong to Active Job), checking SMS opt-out.

### Active Job (Desktop 1280px / Mobile 390px)
The core mechanic workflow — inspecting a vehicle and writing it up. Route: `/jobs/[id]`. **Build status:** all of it is built — findings, photos, the Estimate card, Send Report, and read-only-after-send.

> **Deviation from the Figma wireframe (decided 2026-11-02):** the wireframe shows a fixed checklist plus a "Mechanic Notes" card and a "Parts & Labor" card. The data model (`docs/data-model.md`) has neither a checklist template nor job-level notes or parts/labor lines — it has *findings* (`inspection_items`: title, severity, note, price, photos). The page follows the data model. Reasoning in `docs/product-decisions.md`.

- **Header**: same pattern as Job List (desktop: brand + shift pill + name; mobile: back chevron "‹ Jobs" + shift pill)
- **Job context strip**: vehicle + rego, "Customer · Odometer", status pill
- **Findings list** (list-bar pattern): one bar per finding the mechanic has added — title, one-line note, price, photo count, severity chip (green = Good, amber = Monitor, red = Urgent). Tap a bar to edit it. Empty state: "No findings yet — add the first one."
- **"+ Add Finding"** opens an add/edit form (bottom sheet on mobile, side panel or modal on desktop):
  - Title (required), Severity (required — three large tappable choices, not a dropdown), Price in dollars (required; `0` allowed for a plain "Good" note), Note (optional)
  - Photos: "+ Add Photo" opens the camera/photo picker; each photo is compressed, uploaded straight to S3, and shown as a thumbnail with its own state (uploading with progress / failed with Retry / ready). Up to 4 per finding.
  - Save, Cancel, and Delete (edit only, with a confirm)
  - Desktop layout: findings list ~65% on the left; the right rail (~35%) is the **Estimate** card — a flat receipt-style list of the findings that have a price, plus the total (see the flat-divider exception above). Mobile: list, then Estimate, stacked.
- **Autosave**: every finding is saved to the server when the form is saved; there is no separate "Save Draft" button (the wireframe's is dropped as redundant).
- **Footer** (fixed to bottom): **"Send Report to Customer"** (primary). Disabled with no findings, or while any photo is still uploading. A confirm step comes first ("Send this report? … the findings can't be changed"). On success the page shows the report link with a Copy button and a "Text it to <first name>" button (an `sms:` link, so it opens the mechanic's own Messages), once — the raw link is never retrievable again. Texting it is a later task (SMS provider undecided), so for now the mechanic sends the link themselves. Mobile footer has the 34px safe-area bottom padding.
- **After sending** the job is read-only (status `sent`): findings can't be added, edited or deleted, and the page says when the report was sent. A revised quote is a new report (data-model decision), not in scope here.
- **Action**: "Send Report to Customer" → send, then show the link (the wireframe's navigation to Customer Report is replaced — the customer page is for the customer's phone, not the mechanic's).

### Customer Report (Mobile only, 390px — no desktop version)
What the customer sees when they open the link on their phone.
- **Header** (`--color-ink` bg): shop brand, "Vehicle Health Report" title, vehicle + date
- **Status banner**: full-bleed, colored by overall severity (red in the wireframe since one item is flagged urgent) — "N item(s) need your attention" + one-line breakdown of the rest
- **Inspection Results** (list-bar pattern, read-only): colored status dot + item name + note — no interaction, just display
- **Recommended Work & Estimate**: itemized line items + total, flat-divider style (not bars — see the exception above)
- **Footer** (fixed): "Approve Recommended Work" (primary) + "Call the Shop" (outline), 34px bottom safe-area padding

## 5. Flow / routing

Wired in the Figma prototype — mirror this as your app's navigation:

```
Home ──(Log In / Get Started)──▶ Login
Login ──(Log In)──▶ Job List
Job List ──(+ New Job)──▶ Create Job ──(Create Job)──▶ Active Job
Job List ──(Open on a job)──▶ Active Job
Active Job ──(Send Report to Customer)──▶ report link shown to the mechanic; the customer opens it separately
```

Home is a separate public route; Login/Job List/Create Job/Active Job are the authenticated mechanic app; Customer Report is a standalone link-accessed page (no auth, no nav back into the app).

## 6. Suggested component inventory

- `Button` — primary (brass fill) / outline (brass border) variants; full-width and inline sizing
- `StatusPill` / `StatusChip` — good / monitor / urgent / completed / not-started / in-progress
- `SegmentedControl` — track + N equal segments, one active
- `ListBar` — the reusable rounded-card list item (used in Job List, checklist, inspection results)
- `TextField` — label + 44px bordered input
- `AppHeader` — desktop variant (logo + shift pill + name) and mobile variant (back button + shift pill)
- `ChecklistItem` — name + note + StatusChip, built on ListBar
- `LineItem` — label + price row, for the flat receipt-style cost lists

## 7. Breakpoints

Treat the 390px frame as the mobile layout (standard phone viewport, e.g. Tailwind's default/`sm` range) and the 1280px frame as the desktop layout (`lg`/`xl`+). The two layouts differ enough in structure (not just reflow) that most screens are worth building as distinct layout branches rather than one fluid responsive layout — e.g. Active Job's two-column desktop vs. single-column mobile, or Job List's table row vs. card.
