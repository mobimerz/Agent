"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { acceptDnsChange } from "@/app/(dashboard)/sites/actions";
import { Button } from "@/components/ui/button";

export function AcceptDnsButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!confirm("Accept the current DNS records as the new baseline? Only do this if the change was intentional (new hosting, mail provider…).")) return;
          const res = await acceptDnsChange(siteId);
          if (!res.ok) return void toast.error(res.error);
          toast.success("New DNS records accepted as baseline — re-checking now");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
      Accept this change
    </Button>
  );
}
