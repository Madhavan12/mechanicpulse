import { SmsSendError, type SmsProvider, type SmsRequest } from "./provider";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** A phone number (+61…) or a Messaging Service SID (MG…). Which one is
   * decided by the prefix, so switching to a registered sender ID later is a
   * config change, not a code change. */
  from: string;
}

const TIMEOUT_MS = 10_000;

/** Twilio's REST API over plain fetch — one endpoint, so the SDK isn't worth
 * the dependency. */
export function createTwilioProvider(cfg: TwilioConfig, fetchImpl: typeof fetch = fetch): SmsProvider {
  return {
    name: "twilio",
    async send(req: SmsRequest) {
      const form = new URLSearchParams({ To: req.to, Body: req.body });
      if (cfg.from.startsWith("MG")) form.set("MessagingServiceSid", cfg.from);
      else form.set("From", cfg.from);
      if (req.statusCallbackUrl) form.set("StatusCallback", req.statusCallbackUrl);

      let res: Response;
      try {
        res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new SmsSendError("Could not reach the SMS provider.", "network");
      }

      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        num_segments?: string;
        code?: number;
        message?: string;
      };
      if (!res.ok || !data.sid) {
        throw new SmsSendError(data.message ?? `SMS provider returned ${res.status}.`, data.code ? String(data.code) : String(res.status));
      }
      const segments = Number(data.num_segments);
      return { providerMessageId: data.sid, segments: Number.isInteger(segments) && segments > 0 ? segments : null };
    },
  };
}
