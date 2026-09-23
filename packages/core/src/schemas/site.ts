import { z } from "zod";
import { MIN_INTERVALS } from "../constants";
import { CHECK_TYPES, FRAMEWORKS, SITE_STATUSES, type CheckType } from "../enums";
import { normalizeSiteUrl } from "../url";

const trimmed = (max: number) => z.string().trim().max(max);

export const siteUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .transform((value, ctx) => {
    try {
      const url = normalizeSiteUrl(value);
      const { protocol, hostname } = new URL(url);
      if (!["http:", "https:"].includes(protocol)) throw new Error();
      if (!hostname.includes(".") && hostname !== "localhost") throw new Error();
      return url;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid website URL, e.g. https://example.com" });
      return z.NEVER;
    }
  });

/** Lowercased, trimmed, de-duplicated tags. */
export const tagsSchema = z
  .array(z.string())
  .max(20, "At most 20 tags")
  .transform((tags) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))])
  .pipe(z.array(z.string().max(40, "Tags must be 40 characters or less")));

/** Paths ("/contact") or absolute URLs; normalized to paths/URLs without hash. */
export const importantPagesSchema = z
  .array(z.string())
  .max(10, "At most 10 important pages")
  .transform((pages) => [...new Set(pages.map((p) => p.trim()).filter(Boolean))])
  .superRefine((pages, ctx) => {
    for (const p of pages) {
      if (p.startsWith("/")) continue;
      try {
        const u = new URL(p);
        if (u.protocol === "http:" || u.protocol === "https:") continue;
      } catch {
        // fall through
      }
      ctx.addIssue({ code: "custom", message: `"${p}" must be a path like /contact or a full URL` });
    }
  });

const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().min(min).max(max).optional());

const checkConfigSchema = (type: CheckType) =>
  z.object({
    enabled: z.boolean(),
    intervalSec: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
      z
        .number()
        .int()
        .min(MIN_INTERVALS[type], `Minimum interval is ${Math.round(MIN_INTERVALS[type] / 60)} min`)
        .max(30 * 24 * 3600)
        .optional(),
    ),
  });

export const siteChecksSchema = z.object(
  Object.fromEntries(CHECK_TYPES.map((t) => [t, checkConfigSchema(t).optional()])) as {
    [K in CheckType]: z.ZodOptional<ReturnType<typeof checkConfigSchema>>;
  },
);

export const siteInputSchema = z.object({
  name: trimmed(120).min(1, "Name is required"),
  url: siteUrlSchema,
  clientName: trimmed(120).default(""),
  clientEmail: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
  tags: tagsSchema.default([]),
  notes: trimmed(2000).default(""),
  framework: z.enum(FRAMEWORKS).nullable().default(null),
  status: z.enum(SITE_STATUSES).default("active"),
  checks: siteChecksSchema.default({}),
  thresholds: z
    .object({
      responseTimeWarnMs: optionalInt(200, 60_000),
      minPerformance: optionalInt(0, 100),
      minSeo: optionalInt(0, 100),
    })
    .default({}),
  content: z
    .object({
      requiredKeyword: trimmed(200).default(""),
      extraSpamWords: z
        .array(z.string())
        .max(50)
        .transform((w) => [...new Set(w.map((s) => s.trim().toLowerCase()).filter(Boolean))])
        .default([]),
    })
    .default({ requiredKeyword: "", extraSpamWords: [] }),
  importantPages: importantPagesSchema.default([]),
  form: z
    .object({
      pageUrl: trimmed(500).default(""),
      selector: trimmed(200).default("form"),
      testSubmission: z.boolean().default(false),
      successText: trimmed(200).default(""),
    })
    .default({ pageUrl: "", selector: "form", testSubmission: false, successText: "" }),
});

export type SiteInput = z.input<typeof siteInputSchema>;
export type SiteData = z.output<typeof siteInputSchema>;
