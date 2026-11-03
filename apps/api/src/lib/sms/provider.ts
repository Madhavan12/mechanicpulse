/** One outbound text. The provider turns this into a real message and tells
 * us what it called it, so delivery callbacks can find our row again. */
export interface SmsRequest {
  to: string; // E.164
  body: string;
  /** Absolute URL the provider should POST delivery updates to. Omitted when
   * the API has no public address (local dev), in which case a message never
   * moves past `sent`. */
  statusCallbackUrl?: string;
}

export interface SmsReceipt {
  providerMessageId: string;
  segments: number | null;
}

/** Thrown when the provider refused or couldn't be reached. `code` is the
 * provider's own error code where it gave one — it goes in sms_messages. */
export class SmsSendError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
  }
}

/** Everything provider-specific lives behind this. Swapping Twilio for an AU
 * aggregator later means one new file and one env var. */
export interface SmsProvider {
  /** Stored in sms_messages.provider. */
  readonly name: string;
  send(req: SmsRequest): Promise<SmsReceipt>;
}
