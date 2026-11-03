/** The text a customer gets. Names the workshop (the Spam Act wants the
 * sender identifiable, and with no registered sender ID the customer has
 * nothing else to go on) and keeps to plain GSM-7 characters so it stays one
 * segment of 160 rather than flipping to 70-character Unicode segments. */
export function buildReportMessage(opts: {
  workshopName: string;
  customerName: string;
  vehicle: string;
  itemCount: number;
  url: string;
}): string {
  const first = opts.customerName.trim().split(/\s+/)[0] || "there";
  const things = `${opts.itemCount} ${opts.itemCount === 1 ? "item" : "items"}`;
  return gsmSafe(`Hi ${first}, ${opts.workshopName}: ${things} on your ${opts.vehicle} need your OK: ${opts.url}`);
}

/** Curly quotes and dashes are the usual way a name sneaks Unicode in. */
function gsmSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
}
