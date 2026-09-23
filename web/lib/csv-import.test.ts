import { describe, expect, it } from "vitest";
import { CSV_TEMPLATE, parseSitesCsv } from "./csv-import";

describe("parseSitesCsv", () => {
  it("accepts the downloadable template as-is", () => {
    const r = parseSitesCsv(CSV_TEMPLATE, new Map());
    expect(r.fatal).toBeUndefined();
    expect(r.invalid).toEqual([]);
    expect(r.valid).toHaveLength(3);
    const [a, b, c] = r.valid.map((v) => v.data);
    expect(a).toMatchObject({ url: "https://acmedental.example", tags: ["healthcare", "wordpress"], importantPages: ["/contact", "/services"] });
    expect(a!.content.requiredKeyword).toBe("Book Appointment");
    expect(a!.thresholds.responseTimeWarnMs).toBe(3000);
    expect(b).toMatchObject({ url: "https://sharmatraders.example", framework: "laravel" });
    expect(c!.notes).toBe("Hosted on Vercel, uses Cloudflare");
  });

  it("template only uses reserved .example domains", () => {
    for (const { data } of parseSitesCsv(CSV_TEMPLATE, new Map()).valid) expect(new URL(data.url).hostname).toMatch(/\.example$/);
  });

  it("classifies invalid rows with reasons", () => {
    const csv = "name,url,clientEmail\nBad,not a url,\nWorse,https://ok.in,not-an-email\n,,";
    const r = parseSitesCsv(csv, new Map());
    expect(r.valid).toHaveLength(0);
    expect(r.invalid.map((i) => i.row)).toEqual([2, 3]);
    expect(r.invalid[0]!.errors.join()).toMatch(/valid website URL/);
    expect(r.invalid[1]!.errors.join()).toMatch(/clientEmail/);
  });

  it("detects duplicates against the DB and within the file (by normalized URL)", () => {
    const csv = "url\nhttps://Example.com/\nexample.in\nhttps://example.in";
    const r = parseSitesCsv(csv, new Map([["https://example.com", "Existing Site"]]));
    expect(r.valid.map((v) => v.row)).toEqual([3]);
    expect(r.duplicates).toEqual([
      expect.objectContaining({ row: 2, reason: "exists", conflictWith: "Existing Site" }),
      expect.objectContaining({ row: 4, reason: "in_file", conflictWith: "row 3" }),
    ]);
  });

  it("accepts header aliases and derives a name from the URL", () => {
    const r = parseSitesCsv("Website,Client,Tag\nwww.shop.co.in,Shop Pvt Ltd,ecom|india", new Map());
    expect(r.valid[0]!.data).toMatchObject({ name: "shop.co.in", clientName: "Shop Pvt Ltd", tags: ["ecom", "india"] });
  });

  it("fails fast without a url column", () => {
    expect(parseSitesCsv("name,client\nA,B", new Map()).fatal).toMatch(/url/);
  });
});
