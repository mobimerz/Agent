/**
 * On-page SEO checklist shared by the worker (produces it) and the web app
 * (renders pass/fail + a short "how to fix" hint per failed item).
 */
export const SEO_ITEMS = [
  "noindex_meta",
  "noindex_header",
  "robots_txt",
  "robots_block_all",
  "sitemap_in_robots",
  "sitemap_valid",
  "canonical",
  "title",
  "meta_description",
  "h1",
  "viewport",
  "lang",
] as const;
export type SeoItemId = (typeof SEO_ITEMS)[number];

/** fail = breaks indexing (raises an incident) · warn = should fix · info = nice to have. */
export type SeoItemLevel = "fail" | "warn" | "info";
export type SeoItemStatus = "pass" | SeoItemLevel | "na";

export interface SeoItemDef {
  label: string;
  /** Severity when the item does not pass. */
  level: SeoItemLevel;
  fix: string;
}

export const SEO_ITEM_DEFS: Record<SeoItemId, SeoItemDef> = {
  noindex_meta: {
    label: "No “noindex” robots meta tag",
    level: "fail",
    fix: "Remove <meta name=\"robots\" content=\"noindex\">. WordPress: Settings → Reading → untick “Discourage search engines”. Also check Yoast/RankMath “Allow search engines to show this page”.",
  },
  noindex_header: {
    label: "No “noindex” X-Robots-Tag header",
    level: "fail",
    fix: "Remove the X-Robots-Tag: noindex header from the server (.htaccess / nginx add_header), the CDN (Cloudflare Transform Rules) or the hosting's staging protection.",
  },
  robots_txt: {
    label: "robots.txt exists",
    level: "info",
    fix: "Add /robots.txt with “User-agent: *”, “Disallow:” and a “Sitemap: https://…/sitemap.xml” line (SEO plugins can generate it).",
  },
  robots_block_all: {
    label: "robots.txt allows crawling",
    level: "fail",
    fix: "robots.txt has “User-agent: *” + “Disallow: /”. Change it to “Disallow:” (empty) — usually left over from a staging site.",
  },
  sitemap_in_robots: {
    label: "Sitemap referenced in robots.txt",
    level: "warn",
    fix: "Add a line “Sitemap: https://yourdomain/sitemap.xml” to robots.txt so every search engine finds it (Yoast: sitemap_index.xml).",
  },
  sitemap_valid: {
    label: "Sitemap returns valid XML",
    level: "warn",
    fix: "The sitemap URL must return HTTP 200 with a <urlset> or <sitemapindex> XML document. Regenerate it in the SEO plugin/framework and check caching/security plugins aren't serving HTML instead.",
  },
  canonical: {
    label: "Canonical URL on this domain",
    level: "fail",
    fix: "The canonical tag points to another domain (staging or old domain). Update the site URL in WordPress (Settings → General) / the SEO plugin / your framework's metadata base URL.",
  },
  title: {
    label: "Page title (10–70 characters)",
    level: "warn",
    fix: "Give every important page a unique <title> of roughly 10–70 characters with the main keyword and brand.",
  },
  meta_description: {
    label: "Meta description",
    level: "warn",
    fix: "Add <meta name=\"description\"> (≈ 70–160 characters) summarising the page — it is the snippet Google shows.",
  },
  h1: {
    label: "Exactly one H1 heading",
    level: "info",
    fix: "Use one <h1> per page describing its main topic; use H2/H3 for sections.",
  },
  viewport: {
    label: "Mobile viewport meta tag",
    level: "warn",
    fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> — without it Google treats the page as not mobile-friendly.",
  },
  lang: {
    label: "<html lang> attribute",
    level: "info",
    fix: "Set the page language, e.g. <html lang=\"en\">, for accessibility and correct search targeting.",
  },
};

export interface SeoChecklistItem {
  id: SeoItemId;
  status: SeoItemStatus;
  /** Short evidence, e.g. `content="noindex, nofollow"` or the sitemap URL. */
  detail?: string;
  /** Page the item failed on (for per-page items). */
  pages?: string[];
}
