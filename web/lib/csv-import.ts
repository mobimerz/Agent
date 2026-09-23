import Papa from "papaparse";
import { FRAMEWORKS, siteInputSchema, type SiteData } from "@siteguard/core";

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_BYTES = 1024 * 1024;

/** Canonical columns, in template order. */
export const CSV_COLUMNS = [
  "name",
  "url",
  "clientName",
  "clientEmail",
  "tags",
  "framework",
  "notes",
  "requiredKeyword",
  "importantPages",
  "responseTimeWarnMs",
] as const;
type Column = (typeof CSV_COLUMNS)[number];

/** Accepted header spellings (compared lowercase with non-alphanumerics removed). */
const ALIASES: Record<string, Column> = {
  name: "name",
  sitename: "name",
  website: "url",
  url: "url",
  siteurl: "url",
  domain: "url",
  client: "clientName",
  clientname: "clientName",
  clientemail: "clientEmail",
  email: "clientEmail",
  contactemail: "clientEmail",
  tags: "tags",
  tag: "tags",
  framework: "framework",
  stack: "framework",
  notes: "notes",
  note: "notes",
  keyword: "requiredKeyword",
  requiredkeyword: "requiredKeyword",
  importantpages: "importantPages",
  pages: "importantPages",
  responsetimewarnms: "responseTimeWarnMs",
  slowms: "responseTimeWarnMs",
};

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (v: string) => v.split(/[;|]/).map((s) => s.trim()).filter(Boolean);

export interface ImportRowError {
  row: number;
  name: string;
  url: string;
  errors: string[];
}
export interface ImportDuplicate {
  row: number;
  name: string;
  url: string;
  reason: "exists" | "in_file";
  /** Existing site name, or the earlier row number for in-file duplicates. */
  conflictWith: string;
}
export interface ImportPreview {
  totalRows: number;
  valid: { row: number; data: SiteData }[];
  invalid: ImportRowError[];
  duplicates: ImportDuplicate[];
  unknownColumns: string[];
  fatal?: string;
}

/**
 * Parse and classify a CSV of sites. `existing` maps normalized URL → site name.
 * Row numbers are 1-based spreadsheet rows (header = row 1).
 */
export function parseSitesCsv(text: string, existing: Map<string, string>): ImportPreview {
  const empty: ImportPreview = { totalRows: 0, valid: [], invalid: [], duplicates: [], unknownColumns: [] };
  if (Buffer.byteLength(text) > CSV_MAX_BYTES) return { ...empty, fatal: "File is larger than 1 MB." };

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const mapping = new Map<string, Column>();
  const unknownColumns: string[] = [];
  for (const h of headers) {
    const col = ALIASES[normalizeHeader(h)];
    if (col) mapping.set(h, col);
    else if (h) unknownColumns.push(h);
  }
  const mapped = [...mapping.values()];
  if (!mapped.includes("url")) return { ...empty, unknownColumns, fatal: 'Missing required column "url". Download the template to see the expected format.' };
  if (parsed.data.length > CSV_MAX_ROWS) return { ...empty, fatal: `Too many rows (${parsed.data.length}). Import at most ${CSV_MAX_ROWS} at a time.` };

  const out: ImportPreview = { ...empty, totalRows: parsed.data.length, unknownColumns };
  const seenInFile = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const row = i + 2;
    const rec: Partial<Record<Column, string>> = {};
    for (const [header, col] of mapping) rec[col] = (raw[header] ?? "").trim();

    const url = rec.url ?? "";
    let name = rec.name ?? "";
    if (!name && url) {
      try {
        name = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
      } catch {
        name = url;
      }
    }

    const framework = rec.framework?.toLowerCase().replace(/[^a-z]/g, "") || null;
    const candidate = {
      name,
      url,
      clientName: rec.clientName ?? "",
      clientEmail: rec.clientEmail ?? "",
      tags: rec.tags ? splitList(rec.tags) : [],
      notes: rec.notes ?? "",
      framework: framework && (FRAMEWORKS as readonly string[]).includes(framework) ? framework : framework ? "other" : null,
      content: { requiredKeyword: rec.requiredKeyword ?? "", extraSpamWords: [] },
      importantPages: rec.importantPages ? splitList(rec.importantPages) : [],
      thresholds: { responseTimeWarnMs: rec.responseTimeWarnMs || undefined },
    };

    const result = siteInputSchema.safeParse(candidate);
    if (!result.success) {
      out.invalid.push({
        row,
        name,
        url,
        errors: result.error.issues.map((iss) => `${iss.path.length ? `${iss.path.join(".")}: ` : ""}${iss.message}`),
      });
      return;
    }

    const data = result.data;
    const existingName = existing.get(data.url);
    if (existingName !== undefined) {
      out.duplicates.push({ row, name: data.name, url: data.url, reason: "exists", conflictWith: existingName });
      return;
    }
    const firstRow = seenInFile.get(data.url);
    if (firstRow !== undefined) {
      out.duplicates.push({ row, name: data.name, url: data.url, reason: "in_file", conflictWith: `row ${firstRow}` });
      return;
    }
    seenInFile.set(data.url, row);
    out.valid.push({ row, data });
  });

  return out;
}

// Reserved .example domains only (RFC 2606): importing the template unchanged must never monitor a real site.
export const CSV_TEMPLATE = [
  CSV_COLUMNS.join(","),
  'Acme Dental,https://acmedental.example,Acme Dental Clinic,owner@acmedental.example,healthcare;wordpress,wordpress,Main clinic site,Book Appointment,/contact;/services,3000',
  'Sharma Traders,sharmatraders.example,Sharma Traders,,ecommerce,laravel,,,/cart,',
  'Portfolio - Priya,https://www.priyadesigns.example,Priya Designs,priya@priyadesigns.example,portfolio,nextjs,"Hosted on Vercel, uses Cloudflare",Priya,,5000',
].join("\n");
