"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveAlertSettings, type AlertSettingsInput } from "./actions";

export interface AlertSettingsValues {
  morning: string;
  night: string;
  reportEmail: boolean;
  reportTelegram: boolean;
  alertEmails: string;
  telegramChatIds: string;
  responseTimeWarnMs: string;
  minPerformance: string;
  minSeo: string;
  sslWarnDays: string;
  sslFailDays: string;
  domainWarnDays: string;
  domainFailDays: string;
  reminderAfterMin: string;
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function AlertSettingsForm({ initial, envEmails, envChats, timeZone }: { initial: AlertSettingsValues; envEmails: string[]; envChats: string[]; timeZone: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof AlertSettingsValues>(k: K, value: AlertSettingsValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const num = (k: keyof AlertSettingsValues) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/\D/g, "") as never);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveAlertSettings(v as unknown as AlertSettingsInput);
      if (!res.ok) {
        setErrors(res.fieldErrors);
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success("Settings saved — the worker picks them up within 30 s");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Daily reports</CardTitle>
          <CardDescription>Times are in {timeZone}. A report missed by more than 3 hours (server down) is skipped rather than sent late.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="morning" label="Morning report" error={errors.morning}>
            <Input id="morning" type="time" value={v.morning} onChange={(e) => set("morning", e.target.value)} required />
          </Field>
          <Field id="night" label="Night report" error={errors.night}>
            <Input id="night" type="time" value={v.night} onChange={(e) => set("night", e.target.value)} required />
          </Field>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={v.reportEmail} onCheckedChange={(c) => set("reportEmail", c)} /> Send reports by email
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={v.reportTelegram} onCheckedChange={(c) => set("reportTelegram", c)} /> Send reports on Telegram
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>Used for alerts and reports. Empty = the values from .env.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="emails" label="Alert emails" error={errors.alertEmails} hint={envEmails.length ? `.env: ${envEmails.join(", ")}` : "Comma or newline separated"}>
            <Textarea id="emails" rows={2} value={v.alertEmails} onChange={(e) => set("alertEmails", e.target.value)} placeholder="team@mycompany.com, owner@mycompany.com" />
          </Field>
          <Field id="chats" label="Telegram chat IDs" error={errors.telegramChatIds} hint={envChats.length ? `.env: ${envChats.join(", ")}` : "Personal chats are numbers, groups start with -100…"}>
            <Input id="chats" value={v.telegramChatIds} onChange={(e) => set("telegramChatIds", e.target.value)} placeholder="123456789, -1001234567890" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default thresholds</CardTitle>
          <CardDescription>Apply to every site unless the site overrides them (Edit site).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="rt" label="Slow response (ms)" error={errors.responseTimeWarnMs}>
            <Input id="rt" inputMode="numeric" value={v.responseTimeWarnMs} onChange={num("responseTimeWarnMs")} />
          </Field>
          <Field id="perf" label="Min performance score" error={errors.minPerformance}>
            <Input id="perf" inputMode="numeric" value={v.minPerformance} onChange={num("minPerformance")} />
          </Field>
          <Field id="seo" label="Min Lighthouse SEO score" error={errors.minSeo}>
            <Input id="seo" inputMode="numeric" value={v.minSeo} onChange={num("minSeo")} />
          </Field>
          <Field id="sslw" label="SSL warning (days before expiry)" error={errors.sslWarnDays}>
            <Input id="sslw" inputMode="numeric" value={v.sslWarnDays} onChange={num("sslWarnDays")} />
          </Field>
          <Field id="sslf" label="SSL critical (days)" error={errors.sslFailDays}>
            <Input id="sslf" inputMode="numeric" value={v.sslFailDays} onChange={num("sslFailDays")} />
          </Field>
          <Field id="rem" label="Reminder every (minutes)" error={errors.reminderAfterMin} hint="Unacknowledged critical incidents">
            <Input id="rem" inputMode="numeric" value={v.reminderAfterMin} onChange={num("reminderAfterMin")} />
          </Field>
          <Field id="domw" label="Domain warning (days)" error={errors.domainWarnDays}>
            <Input id="domw" inputMode="numeric" value={v.domainWarnDays} onChange={num("domainWarnDays")} />
          </Field>
          <Field id="domf" label="Domain critical (days)" error={errors.domainFailDays}>
            <Input id="domf" inputMode="numeric" value={v.domainFailDays} onChange={num("domainFailDays")} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
