import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findInviteByToken, type InviteState } from "@/lib/invites";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Accept invite" };

const MESSAGES: Record<Exclude<InviteState, "valid">, string> = {
  not_found: "This invite link is not valid.",
  expired: "This invite has expired. Ask an admin for a new one.",
  used: "This invite has already been used.",
  revoked: "This invite was revoked. Ask an admin for a new one.",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { invite, state } = await findInviteByToken(token);

  if (state !== "valid" || !invite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite unavailable</CardTitle>
          <CardDescription>{MESSAGES[state as Exclude<InviteState, "valid">]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <AcceptInviteForm token={token} email={invite.email} role={invite.role} />;
}
