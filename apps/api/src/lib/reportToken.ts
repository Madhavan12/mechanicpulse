import { randomBytes, createHash, timingSafeEqual } from "crypto";

/** 32 random bytes, base64url-encoded — ~256 bits of entropy. The link is
 * the only credential a customer has, so it has to be unguessable; this is
 * well past brute-forceable even with no rate limiting. */
export function generateReportToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is ever stored (reports.token_hash is bytea, exactly 32
 * bytes). A database dump therefore can't be turned back into working
 * customer links. SHA-256 with no salt is deliberate — the token is already
 * high-entropy, and lookup has to be a single indexed equality check. */
export function hashReportToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Compare two token hashes without leaking length/position through timing.
 * Not needed for the indexed lookup itself, but used where we compare a
 * hash we just computed against one we already hold. */
export function tokenHashEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
