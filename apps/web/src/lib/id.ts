/** A random id for client-side bookkeeping (list keys and the like).
 * `crypto.randomUUID` only exists on secure pages (HTTPS or localhost), so it
 * is missing when the app is opened over plain http on a LAN address, which is
 * how a phone reaches a dev server. `getRandomValues` works everywhere. Not
 * for anything a server trusts. */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
