import { describe, it, expect, vi } from "vitest";
import { createTwilioProvider } from "./twilioProvider";
import { createConsoleProvider } from "./consoleProvider";
import { SmsSendError } from "./provider";
import { smsProviderFromEnv } from "./index";
import { twilioSignature, validTwilioSignature } from "./twilioSignature";

const cfg = { accountSid: "AC123", authToken: "secret", from: "+61400000000" };

function fakeFetch(status: number, json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("twilio provider", () => {
  it("posts To/From/Body/StatusCallback with basic auth to the account's Messages endpoint", async () => {
    const f = fakeFetch(201, { sid: "SM1", num_segments: "2" });
    const receipt = await createTwilioProvider(cfg, f).send({
      to: "+61412345678",
      body: "hello",
      statusCallbackUrl: "https://api.example.test/api/sms/twilio/status",
    });

    expect(receipt).toEqual({ providerMessageId: "SM1", segments: 2 });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const form = init.body as URLSearchParams;
    expect(form.get("To")).toBe("+61412345678");
    expect(form.get("From")).toBe("+61400000000");
    expect(form.get("Body")).toBe("hello");
    expect(form.get("StatusCallback")).toBe("https://api.example.test/api/sms/twilio/status");
    expect(form.has("MessagingServiceSid")).toBe(false);
  });

  it("uses MessagingServiceSid when the sender is a messaging service, and omits the callback when there isn't one", async () => {
    const f = fakeFetch(201, { sid: "SM1" });
    await createTwilioProvider({ ...cfg, from: "MG999" }, f).send({ to: "+61412345678", body: "x" });
    const form = ((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    expect(form.get("MessagingServiceSid")).toBe("MG999");
    expect(form.has("From")).toBe(false);
    expect(form.has("StatusCallback")).toBe(false);
  });

  it("turns a Twilio error into an SmsSendError carrying Twilio's code", async () => {
    const f = fakeFetch(400, { code: 21211, message: "Invalid 'To' Phone Number" });
    const err = await createTwilioProvider(cfg, f).send({ to: "+61412345678", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.code).toBe("21211");
    expect(err.message).toMatch(/Invalid/);
  });

  it("turns a network failure into an SmsSendError", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const err = await createTwilioProvider(cfg, f).send({ to: "+61412345678", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.code).toBe("network");
  });
});

describe("console provider", () => {
  it("logs the text and succeeds without sending anything", async () => {
    const log = vi.fn();
    const receipt = await createConsoleProvider(log).send({ to: "+61412345678", body: "hello" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("+61412345678"));
    expect(receipt.providerMessageId).toMatch(/^console-/);
    expect(receipt.segments).toBe(1);
  });
});

describe("smsProviderFromEnv", () => {
  it("defaults to the console provider so nothing real is sent by accident", () => {
    expect(smsProviderFromEnv({}).name).toBe("console");
    expect(smsProviderFromEnv({ SMS_PROVIDER: "console" }).name).toBe("console");
  });

  it("builds Twilio when configured", () => {
    const env = { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+61400000000" };
    expect(smsProviderFromEnv(env).name).toBe("twilio");
  });

  it.each(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"])("fails at startup if %s is missing", (missing) => {
    const env: Record<string, string> = { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+61400000000" };
    delete env[missing];
    expect(() => smsProviderFromEnv(env)).toThrow(/TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM/);
  });
});

describe("twilio signature", () => {
  // Worked example from Twilio's "Validating requests" documentation.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
    From: "+14158675310",
    To: "+18005551212",
  };
  const authToken = "12345";

  it("matches Twilio's documented example", () => {
    expect(twilioSignature(authToken, url, params)).toBe("GvWf1cFY/Q7PnoempGyD5oXAezc=");
  });

  it("accepts the right signature and rejects anything else", () => {
    const good = twilioSignature(authToken, url, params);
    expect(validTwilioSignature(authToken, url, params, good)).toBe(true);
    expect(validTwilioSignature(authToken, url, { ...params, Digits: "9999" }, good)).toBe(false);
    expect(validTwilioSignature("wrong", url, params, good)).toBe(false);
    expect(validTwilioSignature(authToken, url, params, undefined)).toBe(false);
    expect(validTwilioSignature(authToken, url, params, "short")).toBe(false);
  });
});
