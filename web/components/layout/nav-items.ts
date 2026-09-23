import type { Route } from "next";
import { AlertTriangleIcon, BellIcon, GlobeIcon, LayoutDashboardIcon, SettingsIcon, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/sites", label: "Sites", icon: GlobeIcon },
  { href: "/incidents", label: "Incidents", icon: AlertTriangleIcon },
  { href: "/notifications", label: "Notifications", icon: BellIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
