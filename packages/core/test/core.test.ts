import { describe, expect, it } from "vitest";
import { dayKey, normalizeSiteUrl, parseHm, siteHostname } from "../src";
import { parseEnv, workerEnvSchema } from "../src/env";

describe("normalizeSiteUrl", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["HTTPS://Example.COM/", "https://example.com"],
    ["http://example.co.in/contact#form", "http://example.co.in/contact"],
    ["  https://shop.example.in/?q=1 ", "https://shop.example.in/?q=1"],
    ["localhost:3000/api/dev/test-target?status=500", "http://localhost:3000/api/dev/test-target?status=500"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["localhostshop.com", "https://localhostshop.com"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSiteUrl(input)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(() => normalizeSiteUrl("http://")).toThrow();
  });
});

describe("siteHostname", () => {
  it("strips www", () => {
    expect(siteHostname("https://www.example.co.in/about")).toBe("example.co.in");
  });
});

describe("dayKey", () => {
  it("uses the configured timezone (IST rolls over at 18:30 UTC)", () => {
    const d = new Date("2026-09-23T18:45:00Z");
    expect(dayKey(d, "UTC")).toBe("2026-09-23");
    expect(dayKey(d, "Asia/Kolkata")).toBe("2026-09-24");
  });
});

describe("parseHm", () => {
  it("parses and validates HH:MM", () => {
    expect(parseHm("09:00")).toEqual([9, 0]);
    expect(parseHm("21:30")).toEqual([21, 30]);
    expect(() => parseHm("24:00")).toThrow();
    expect(() => parseHm("9:00")).toThrow();
  });
});

describe("env parsing", () => {
  it("applies defaults and splits email lists", () => {
    const env = parseEnv(workerEnvSchema, {
      MONGODB_URI: "mongodb://localhost/x",
      ALERT_TO_EMAILS: "a@x.com, b@y.in",
      PSI_API_KEY: "",
    });
    expect(env.TIMEZONE).toBe("Asia/Kolkata");
    expect(env.ALERT_TO_EMAILS).toEqual(["a@x.com", "b@y.in"]);
    expect(env.PSI_API_KEY).toBeUndefined();
    expect(env.EMAIL_RESERVED_FOR_REPORTS).toBe(10);
  });

  it("reports invalid values clearly", () => {
    expect(() => parseEnv(workerEnvSchema, { MONGODB_URI: "postgres://x" })).toThrow(/MONGODB_URI/);
  });
});
