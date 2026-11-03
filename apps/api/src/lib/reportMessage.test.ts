import { describe, it, expect } from "vitest";
import { buildReportMessage } from "./reportMessage";

const base = {
  workshopName: "Acme Motors",
  customerName: "Sam Customer",
  vehicle: "Toyota Corolla",
  itemCount: 2,
  url: "https://app.example.test/r/abc",
};

describe("buildReportMessage", () => {
  it("names the customer, the workshop, the car and carries the link", () => {
    expect(buildReportMessage(base)).toBe(
      "Hi Sam, Acme Motors: 2 items on your Toyota Corolla need your OK: https://app.example.test/r/abc"
    );
  });

  it("says 'item' for one", () => {
    expect(buildReportMessage({ ...base, itemCount: 1 })).toContain("1 item on");
  });

  it("falls back to 'there' for a blank name", () => {
    expect(buildReportMessage({ ...base, customerName: "  " })).toMatch(/^Hi there,/);
  });

  it("replaces curly quotes and dashes so the text stays GSM-7 (one segment, not 70-char Unicode)", () => {
    const msg = buildReportMessage({ ...base, workshopName: "Dave’s “Best” Auto – Parramatta" });
    expect(msg).toContain(`Dave's "Best" Auto - Parramatta`);
    expect(msg).toMatch(/^[\x20-\x7E]+$/);
  });

  it("stays within one 160-character segment with a typical production link", () => {
    const url = `https://app.mechanicpulse.com.au/r/${"x".repeat(43)}`;
    expect(buildReportMessage({ ...base, url }).length).toBeLessThanOrEqual(160);
  });
});
