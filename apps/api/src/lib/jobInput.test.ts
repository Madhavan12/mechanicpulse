import { describe, it, expect } from "vitest";
import { normaliseAuMobile, normaliseRego, parseCreateJob } from "./jobInput";

describe("normaliseAuMobile", () => {
  it.each(["0412 345 678", "0412345678", "+61412345678", "61412345678", "+61 412 345 678", "(04) 1234-5678"])(
    "accepts %s as +61412345678",
    (raw) => expect(normaliseAuMobile(raw)).toBe("+61412345678")
  );

  it.each(["12345", "0212345678", "+61212345678", "041234567", "04123456789", "abc", "", "+14155550123"])(
    "rejects %s",
    (raw) => expect(normaliseAuMobile(raw)).toBeNull()
  );
});

describe("normaliseRego", () => {
  it("upper-cases and strips spaces", () => expect(normaliseRego("abc 123")).toBe("ABC123"));
  it.each(["AB-123", "ABC!23", "", "   ", "ABCDEFGHIJ"])("rejects %s", (raw) => expect(normaliseRego(raw)).toBeNull());
});

describe("parseCreateJob", () => {
  const valid = { customerName: " Alex ", customerMobile: "0412 345 678", rego: "abc123" };

  it("cleans a valid body", () => {
    expect(parseCreateJob(valid)).toEqual({
      ok: true,
      value: { customerName: "Alex", mobileE164: "+61412345678", rego: "ABC123", make: null, model: null, odometerKm: null },
    });
  });

  it("treats blank optional text as absent", () => {
    const r = parseCreateJob({ ...valid, make: "  ", model: "Corolla" });
    expect(r).toMatchObject({ ok: true, value: { make: null, model: "Corolla" } });
  });

  it.each([
    ["no body", undefined, "customerName"],
    ["a blank name", { ...valid, customerName: "  " }, "customerName"],
    ["a non-string name", { ...valid, customerName: 5 }, "customerName"],
    ["a bad mobile", { ...valid, customerMobile: "12345" }, "customerMobile"],
    ["a bad rego", { ...valid, rego: "AB-12" }, "rego"],
    ["a non-string make", { ...valid, make: 7 }, "make"],
    ["a negative odometer", { ...valid, odometerKm: -1 }, "odometerKm"],
    ["a fractional odometer", { ...valid, odometerKm: 10.5 }, "odometerKm"],
    ["a string odometer", { ...valid, odometerKm: "100" }, "odometerKm"],
  ])("rejects %s", (_label, body, field) => {
    const r = parseCreateJob(body as never);
    expect(r).toMatchObject({ ok: false, error: { error: "invalid_field", field } });
  });

  it.each([
    ["a name over 100 characters", { ...valid, customerName: "x".repeat(101) }, "customerName"],
    ["a make over 50 characters", { ...valid, make: "x".repeat(51) }, "make"],
    ["a model over 50 characters", { ...valid, model: "x".repeat(51) }, "model"],
    ["an odometer over 9,999,999", { ...valid, odometerKm: 10_000_000 }, "odometerKm"],
  ])("rejects %s", (_label, body, field) => {
    expect(parseCreateJob(body)).toMatchObject({ ok: false, error: { field } });
  });

  it("accepts values exactly at the limits", () => {
    const r = parseCreateJob({ ...valid, customerName: "x".repeat(100), make: "m".repeat(50), model: "d".repeat(50), odometerKm: 9_999_999 });
    expect(r.ok).toBe(true);
  });

  it("accepts an odometer of zero", () => {
    expect(parseCreateJob({ ...valid, odometerKm: 0 })).toMatchObject({ ok: true, value: { odometerKm: 0 } });
  });
});
