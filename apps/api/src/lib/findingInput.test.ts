import { describe, it, expect } from "vitest";
import { parseFinding, MAX_PRICE_CENTS } from "./findingInput";

const valid = { title: " Front brake pads worn ", severity: "red", priceCents: 28900 };

describe("parseFinding", () => {
  it("cleans a valid body", () => {
    expect(parseFinding(valid)).toEqual({
      ok: true,
      value: { title: "Front brake pads worn", severity: "red", priceCents: 28900, note: null },
    });
  });

  it("keeps a trimmed note and treats a blank one as absent", () => {
    expect(parseFinding({ ...valid, note: "  2mm left " })).toMatchObject({ ok: true, value: { note: "2mm left" } });
    expect(parseFinding({ ...valid, note: "   " })).toMatchObject({ ok: true, value: { note: null } });
  });

  it("accepts a price of zero and the maximum", () => {
    expect(parseFinding({ ...valid, priceCents: 0 }).ok).toBe(true);
    expect(parseFinding({ ...valid, priceCents: MAX_PRICE_CENTS }).ok).toBe(true);
  });

  it.each(["red", "amber", "green"])("accepts severity %s", (severity) => {
    expect(parseFinding({ ...valid, severity }).ok).toBe(true);
  });

  it.each([
    ["no body", undefined, "title"],
    ["a blank title", { ...valid, title: "  " }, "title"],
    ["a non-string title", { ...valid, title: 3 }, "title"],
    ["a title over 120 characters", { ...valid, title: "x".repeat(121) }, "title"],
    ["an unknown severity", { ...valid, severity: "purple" }, "severity"],
    ["a missing severity", { title: "x", priceCents: 1 }, "severity"],
    ["a negative price", { ...valid, priceCents: -1 }, "priceCents"],
    ["a fractional price", { ...valid, priceCents: 10.5 }, "priceCents"],
    ["a string price", { ...valid, priceCents: "100" }, "priceCents"],
    ["a missing price", { title: "x", severity: "red" }, "priceCents"],
    ["a price over the maximum", { ...valid, priceCents: MAX_PRICE_CENTS + 1 }, "priceCents"],
    ["a non-string note", { ...valid, note: 5 }, "note"],
    ["a note over 1000 characters", { ...valid, note: "x".repeat(1001) }, "note"],
  ])("rejects %s", (_label, body, field) => {
    expect(parseFinding(body as never)).toMatchObject({ ok: false, error: { error: "invalid_field", field } });
  });
});
