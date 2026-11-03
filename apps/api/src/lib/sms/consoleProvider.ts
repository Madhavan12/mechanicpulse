import { randomUUID } from "crypto";
import type { SmsProvider, SmsRequest } from "./provider";

/** Dev and CI: logs the text instead of sending it, and always succeeds.
 * The default whenever Twilio isn't configured, so a fresh checkout and the
 * e2e suite never spend money or text a real phone. */
export function createConsoleProvider(log: (msg: string) => void = console.log): SmsProvider {
  return {
    name: "console",
    async send(req: SmsRequest) {
      log(`[sms:console] to ${req.to}: ${req.body}`);
      return { providerMessageId: `console-${randomUUID()}`, segments: smsSegments(req.body) };
    },
  };
}

/** Rough segment count: 160 chars for one GSM-7 segment, 153 each after that.
 * Good enough for the dev provider; Twilio reports the real number. */
function smsSegments(body: string): number {
  return body.length <= 160 ? 1 : Math.ceil(body.length / 153);
}
