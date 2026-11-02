import type { FindingFieldError, SaveFindingRequest, Severity } from "../../../../packages/shared/types";

export interface CleanFinding {
  title: string;
  severity: Severity;
  priceCents: number;
  note: string | null;
}

type Result = { ok: true; value: CleanFinding } | { ok: false; error: FindingFieldError };

const SEVERITIES: readonly string[] = ["red", "amber", "green"];
export const MAX_PRICE_CENTS = 99_999_999; // $999,999.99 — well inside the integer column

function fail(field: FindingFieldError["field"], message: string): Result {
  return { ok: false, error: { error: "invalid_field", field, message } };
}

/** Untrusted body in, clean values out. The form checks the same things for
 * speed; this is the authority. */
export function parseFinding(body: Partial<Record<keyof SaveFindingRequest, unknown>> | undefined | null): Result {
  const b = body ?? {};

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return fail("title", "Enter a title for this finding.");
  if (title.length > 120) return fail("title", "Keep the title under 120 characters.");

  if (typeof b.severity !== "string" || !SEVERITIES.includes(b.severity)) {
    return fail("severity", "Choose Good, Monitor or Urgent.");
  }

  if (
    typeof b.priceCents !== "number" ||
    !Number.isInteger(b.priceCents) ||
    b.priceCents < 0 ||
    b.priceCents > MAX_PRICE_CENTS
  ) {
    return fail("priceCents", "Enter a price of $0 or more.");
  }

  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") return fail("note", "The note must be text.");
    const trimmed = b.note.trim();
    if (trimmed.length > 1000) return fail("note", "Keep the note under 1000 characters.");
    note = trimmed || null;
  }

  return { ok: true, value: { title, severity: b.severity as Severity, priceCents: b.priceCents, note } };
}
