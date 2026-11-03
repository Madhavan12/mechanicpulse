import { createConsoleProvider } from "./consoleProvider";
import { createTwilioProvider } from "./twilioProvider";
import type { SmsProvider } from "./provider";

export type { SmsProvider } from "./provider";
export { SmsSendError } from "./provider";

/** SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_FROM. Anything else (including unset) is the console provider, so
 * nothing real is ever sent by accident. Misconfiguring Twilio fails loudly at
 * startup instead of at the first customer's first text. */
export function smsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  if (env.SMS_PROVIDER !== "twilio") return createConsoleProvider();
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    throw new Error("SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.");
  }
  return createTwilioProvider({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM });
}
