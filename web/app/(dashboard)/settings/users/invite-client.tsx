"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CopyIcon, MailIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "@siteguard/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvite, emailInvite, revokeInvite } from "./actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; role: Role } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [emailing, startEmailing] = useTransition();

  function sendByEmail() {
    startEmailing(async () => {
      if (!link || !invited) return;
      const res = await emailInvite({ email: invited.email, url: link, role: invited.role });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.state === "preview") {
        toast.info("Preview mode: invite email rendered, not sent", {
          action: { label: "View", onClick: () => window.open(`/dev/emails?id=${res.data.previewId}`, "_blank") },
        });
      } else {
        toast.success(`Invite emailed to ${invited.email}`);
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createInvite({ email, role });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLink(res.data.url);
      setInvited({ email, role });
      setCopied(false);
      setEmail("");
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Copy failed — select the link and copy it manually.");
    }
  }

  return (
    <>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            placeholder="teammate@mycompany.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </form>

      <Dialog open={link !== null} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link created</DialogTitle>
            <DialogDescription>
              Share this link with your teammate. It works once and expires in 7 days. It won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={link ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button type="button" size="icon" variant="outline" onClick={copy} aria-label="Copy link">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={sendByEmail} disabled={emailing || !invited}>
              <MailIcon /> {emailing ? "Sending…" : "Send by email"}
            </Button>
            <Button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Revoke invite"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await revokeInvite(inviteId);
          if (res.ok) toast.success("Invite revoked");
          else toast.error(res.error);
        })
      }
    >
      <XIcon />
    </Button>
  );
}
