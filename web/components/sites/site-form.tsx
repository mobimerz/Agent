"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import { ACTIVE_CHECK_TYPES, CHECK_LABELS, CHECK_PHASE, CHECK_TYPES, FRAMEWORKS, type CheckType, type SiteInput } from "@siteguard/core";
import { createSite, updateSite } from "@/app/(dashboard)/sites/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatInterval } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Everything as strings/booleans for inputs; converted to SiteInput on submit. */
export interface SiteFormValues {
  name: string;
  url: string;
  clientName: string;
  clientEmail: string;
  tags: string;
  framework: string;
  notes: string;
  checks: Record<CheckType, { enabled: boolean; intervalMin: string }>;
  responseTimeWarnMs: string;
  minPerformance: string;
  minSeo: string;
  importantPages: string;
  requiredKeyword: string;
  extraSpamWords: string;
  formPageUrl: string;
  formSelector: string;
  formTestSubmission: boolean;
  formSuccessText: string;
}

const NONE = "__none";
const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js",
  react: "React",
  wordpress: "WordPress",
  html: "Plain HTML",
  laravel: "Laravel",
  shopify: "Shopify",
  other: "Other",
};

const splitList = (s: string, sep = /[,\n]/) => s.split(sep).map((v) => v.trim()).filter(Boolean);

function toInput(v: SiteFormValues): SiteInput {
  return {
    name: v.name,
    url: v.url,
    clientName: v.clientName,
    clientEmail: v.clientEmail.trim(),
    tags: splitList(v.tags),
    framework: (v.framework || null) as SiteInput["framework"],
    notes: v.notes,
    checks: Object.fromEntries(
      CHECK_TYPES.map((t) => [t, { enabled: v.checks[t].enabled, intervalSec: v.checks[t].intervalMin ? Math.round(Number(v.checks[t].intervalMin) * 60) : undefined }]),
    ),
    thresholds: { responseTimeWarnMs: v.responseTimeWarnMs || undefined, minPerformance: v.minPerformance || undefined, minSeo: v.minSeo || undefined },
    importantPages: splitList(v.importantPages, /\n/),
    content: { requiredKeyword: v.requiredKeyword, extraSpamWords: splitList(v.extraSpamWords) },
    form: { pageUrl: v.formPageUrl, selector: v.formSelector || "form", testSubmission: v.formTestSubmission, successText: v.formSuccessText },
  };
}

function Field({ id, label, error, hint, children, className }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p data-field-error className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SiteForm({
  mode,
  siteId,
  initial,
  defaultIntervals,
}: {
  mode: "create" | "edit";
  siteId?: string;
  initial: SiteFormValues;
  defaultIntervals: Record<CheckType, number>;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof SiteFormValues>(key: K, value: SiteFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const setCheck = (t: CheckType, patch: Partial<SiteFormValues["checks"][CheckType]>) =>
    setV((prev) => ({ ...prev, checks: { ...prev.checks, [t]: { ...prev.checks[t], ...patch } } }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const input = toInput(v);
      const res = mode === "create" ? await createSite(input) : await updateSite(siteId!, input);
      if (!res.ok) {
        setFormError(res.error);
        setErrors(res.fieldErrors ?? {});
        // Bring the first problem into view (errors can be far down the form).
        requestAnimationFrame(() => document.querySelector("[data-field-error], [data-form-error]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
        return;
      }
      toast.success(mode === "create" ? "Site added — first checks run within ~30 s" : "Site updated");
      router.push(`/sites/${res.data.id}` as Route);
      router.refresh();
    });
  }

  const err = (key: string) => errors[key] ?? Object.entries(errors).find(([k]) => k.startsWith(`${key}.`))?.[1];

  return (
    <form onSubmit={submit} className="grid gap-6">
      {formError && (
        <Alert variant="destructive" data-form-error>
          <AlertTriangleIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Website</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Name *" error={err("name")}>
            <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} required placeholder="Acme Dental" />
          </Field>
          <Field id="url" label="URL *" error={err("url")} hint="https:// is added if missing">
            <Input id="url" value={v.url} onChange={(e) => set("url", e.target.value)} required placeholder="https://acmedental.in" inputMode="url" />
          </Field>
          <Field id="clientName" label="Client name" error={err("clientName")}>
            <Input id="clientName" value={v.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Acme Dental Clinic" />
          </Field>
          <Field id="clientEmail" label="Client contact email" error={err("clientEmail")}>
            <Input id="clientEmail" type="email" value={v.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} placeholder="owner@acmedental.in" />
          </Field>
          <Field id="tags" label="Tags" error={err("tags")} hint="Comma separated, e.g. healthcare, wordpress">
            <Input id="tags" value={v.tags} onChange={(e) => set("tags", e.target.value)} />
          </Field>
          <Field id="framework" label="Framework">
            <Select value={v.framework || NONE} onValueChange={(val) => set("framework", val === NONE ? "" : val)}>
              <SelectTrigger id="framework" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {FRAMEWORKS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FRAMEWORK_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="notes" label="Notes" className="sm:col-span-2">
            <Textarea id="notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Hosting, access details location, special cases…" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Leave the interval empty to use the global default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {CHECK_TYPES.map((t) => {
            const active = ACTIVE_CHECK_TYPES.includes(t);
            return (
              <div key={t} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2.5 last:border-0">
                <Switch id={`chk-${t}`} checked={v.checks[t].enabled} onCheckedChange={(c) => setCheck(t, { enabled: c })} />
                <Label htmlFor={`chk-${t}`} className="min-w-40 flex-1 font-normal">
                  {CHECK_LABELS[t]}
                  {!active && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Phase {CHECK_PHASE[t]}
                    </Badge>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`${CHECK_LABELS[t]} interval in minutes`}
                    className="h-8 w-32"
                    inputMode="numeric"
                    placeholder={`default ${formatInterval(defaultIntervals[t])}`}
                    value={v.checks[t].intervalMin}
                    onChange={(e) => setCheck(t, { intervalMin: e.target.value.replace(/[^\d.]/g, "") })}
                    disabled={!v.checks[t].enabled}
                  />
                  <span className="text-muted-foreground w-8 text-xs">min</span>
                </div>
                {err(`checks.${t}`) && <p data-field-error className="text-destructive w-full text-xs">{err(`checks.${t}`)}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uptime & content</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="rt" label="Slow response threshold (ms)" error={err("thresholds.responseTimeWarnMs")} hint="WARN “slow” above this. Default 3000 ms.">
            <Input id="rt" inputMode="numeric" placeholder="3000" value={v.responseTimeWarnMs} onChange={(e) => set("responseTimeWarnMs", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field id="kw" label="Required keyword" error={err("content")} hint="FAIL if this text disappears from the homepage.">
            <Input id="kw" value={v.requiredKeyword} onChange={(e) => set("requiredKeyword", e.target.value)} placeholder="Book Appointment" />
          </Field>
          <Field id="pages" label="Important pages" error={err("importantPages")} hint="One per line: /contact, /services…" >
            <Textarea id="pages" rows={3} value={v.importantPages} onChange={(e) => set("importantPages", e.target.value)} placeholder={"/contact\n/services"} />
          </Field>
          <Field id="spam" label="Extra spam / hack words" hint="Comma separated, added to the built-in list.">
            <Textarea id="spam" rows={3} value={v.extraSpamWords} onChange={(e) => set("extraSpamWords", e.target.value)} placeholder="crypto giveaway, cheap followers" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PageSpeed & SEO thresholds</CardTitle>
          <CardDescription>Alert when the median of the last 3 Lighthouse runs stays below these for 2 runs in a row. Empty = global default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="minPerf" label="Minimum performance score (0–100)" error={err("thresholds.minPerformance")} hint="Default 50. Mobile or desktop below this → warning.">
            <Input id="minPerf" inputMode="numeric" placeholder="50" value={v.minPerformance} onChange={(e) => set("minPerformance", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field id="minSeo" label="Minimum Lighthouse SEO score (0–100)" error={err("thresholds.minSeo")} hint="Default 80.">
            <Input id="minSeo" inputMode="numeric" placeholder="80" value={v.minSeo} onChange={(e) => set("minSeo", e.target.value.replace(/\D/g, ""))} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact form</CardTitle>
          <CardDescription>Turn on “Contact Form” under Checks above. By default the form is only opened in a real browser and checked (fields + submit button) — nothing is sent.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="formUrl" label="Form page URL" hint="Full URL or path, e.g. /contact">
            <Input id="formUrl" value={v.formPageUrl} onChange={(e) => set("formPageUrl", e.target.value)} placeholder="/contact" />
          </Field>
          <Field id="formSel" label="Form CSS selector" hint="Default “form” = first visible form (search forms are skipped).">
            <Input id="formSel" value={v.formSelector} onChange={(e) => set("formSelector", e.target.value)} placeholder="form" />
          </Field>
          <Field id="formOk" label="Success text" className="sm:col-span-2" hint="Text the form shows after a successful send, e.g. “Thank you for your message”. Empty = auto-detect common form plugins.">
            <Input id="formOk" value={v.formSuccessText} onChange={(e) => set("formSuccessText", e.target.value)} placeholder="Thank you for your message" />
          </Field>
          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch id="formTest" checked={v.formTestSubmission} onCheckedChange={(c) => set("formTestSubmission", c)} />
            <div className="grid gap-1">
              <Label htmlFor="formTest" className="font-normal">
                Test submission mode
              </Label>
              <p className={cn("text-xs", v.formTestSubmission ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                Actually submits the form with “[SITEGUARD-TEST]” data — your client WILL receive these emails. Keep off unless they agreed.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="bg-background/80 sticky bottom-0 -mx-4 flex justify-end gap-2 border-t px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add site" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
