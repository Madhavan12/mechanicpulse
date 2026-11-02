/** Dollars (what the mechanic types) <-> integer cents (what the API and
 * database store). No floats anywhere near the arithmetic. */

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatCents(cents: number): string {
  return AUD.format(cents / 100);
}

/** "28.90", "$1,200", "45" -> cents. Returns null for anything that isn't a
 * plain dollar amount with at most two decimals. */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

/** 28900 -> "289.00", for pre-filling the edit form. */
export function centsToDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
