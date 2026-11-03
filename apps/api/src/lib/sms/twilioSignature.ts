import { createHmac, timingSafeEqual } from "crypto";

/** Twilio signs every webhook: base64(HMAC-SHA1(authToken, url + each POST
 * param as key+value, keys sorted)). Without this check anyone who finds the
 * callback URL could mark messages delivered. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | undefined
): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
