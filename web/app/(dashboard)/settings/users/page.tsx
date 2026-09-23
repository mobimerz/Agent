import { Invite, mongoose } from "@siteguard/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { InviteForm, RevokeInviteButton } from "./invite-client";

export const metadata = { title: "Users & invites" };

interface UserRow {
  _id: unknown;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt: Date;
}

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TIMEZONE });

export default async function UsersPage() {
  const session = await requireAdmin();
  await db();

  const [users, invites] = await Promise.all([
    mongoose.connection.db!.collection<UserRow>("user").find({}, { sort: { createdAt: 1 } }).toArray(),
    Invite.find({ acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return (
    <>
      <PageHeader title="Users & invites" description="SiteGuard is invite-only. Admins manage everything; members can view and acknowledge." />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending invites ({invites.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pending invites.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden sm:table-cell">Expires</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((inv) => (
                    <TableRow key={String(inv._id)}>
                      <TableCell className="max-w-48 truncate">{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="uppercase">
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">{fmt.format(inv.expiresAt)}</TableCell>
                      <TableCell>
                        <RevokeInviteButton inviteId={String(inv._id)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users ({users.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={String(u._id)}>
                    <TableCell>
                      <div className="font-medium">
                        {u.name}
                        {String(u._id) === session.user.id && <span className="text-muted-foreground ml-1 text-xs">(you)</span>}
                      </div>
                      <div className="text-muted-foreground max-w-48 truncate text-xs sm:hidden">{u.email}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="uppercase">
                        {u.role ?? "member"}
                      </Badge>
                      {u.banned && (
                        <Badge variant="destructive" className="ml-1">
                          disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">{fmt.format(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
