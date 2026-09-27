# MechanicPulse — Design

Visual design decisions: palette, color usage rules, and anything else needed before wireframing starts. Same spirit as `product-decisions.md` — record the "why", not just the pick, so it isn't re-litigated later.

---

## Color palette: "Mechanicals" (locked in)

**Chosen:** Palette 3 ("Mechanicals") over two other candidate palettes.

**Why:** Both screens in this product — the mechanic app and the customer report page — have a hard requirement the other two candidate palettes couldn't meet: a viewer needs to tell "this is fine" from "this needs attention" at a glance, whether or not it's explicitly labelled red/amber/green. Palette 3 is the only candidate with a usable red and amber already in it; the other two would require importing colors from outside the palette just to flag a worn part, which defeats the point of picking one cohesive palette.

It also gives a genuine light/dark neutral pair (cream/ink) at 14.3:1 contrast, so body text and background are sorted with no extra work. One candidate palette had comparable neutral contrast (12.5:1) but no semantic color at all; the other had no color reliably clearing normal-text contrast, and its greens/olives read more "garden centre" than "workshop."

### The five colors

| Hex | Role | Notes |
|---|---|---|
| `#090805` | Primary text, icons | |
| `#e8daa6` | Page background / surface | Cream. Pairs with `#090805` at 14.3:1 contrast |
| `#6c5c0b` | Secondary text, borders, muted UI chrome | The mechanic app's dense forms/tables should lean on this, not the accent colors, to avoid fatigue over a shift |
| `#f1b22a` | "Monitor / attention" badge fill, in-progress status | **Fill only, never text.** At 1.35:1 contrast against the cream background it's basically illegible as text — badge/icon fill with dark text on top only |
| `#cf0000` | "Needs immediate attention" | Sparingly. If every second line item is flagged red, urgency stops meaning anything and the customer report reads as alarming rather than trustworthy — reserve it for genuine needs-attention-now items |

### Rejected

Two other candidate palettes were considered and rejected:
- One had strong neutral contrast (12.5:1) but no semantic (red/amber) color at all — would've needed off-palette colors for severity, defeating the purpose of a locked palette.
- One had mint-green/olive accents that read as off-brand for a workshop context, and no color in it reliably cleared normal-text contrast against its own background.

### Open follow-up

Mock the customer report page's status list first, before full wireframes — that's where the red/amber usage rule (sparing red, fill-only amber) gets stress-tested fastest.
