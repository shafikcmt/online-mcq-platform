import {
  BarChart3,
  BookOpenCheck,
  CreditCard,
  FileText,
  FolderTree,
  HelpCircle,
  LayoutDashboard,
  Megaphone,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Timer,
  Trophy,
  Users,
  Mail,
  ListChecks,
  Library,
  Smartphone,
  Landmark,
  type LucideIcon,
} from "lucide-react";

import type { MessageKey } from "@/lib/i18n/messages";

export type NavItem = {
  key: MessageKey;
  href: string;
  icon: LucideIcon;
  /** false = the screen is not built yet (shown, but not a link). */
  ready: boolean;
};
export type NavGroup = { key: MessageKey; items: NavItem[] };

/** Information architecture (docs/UI_UX_GUIDELINES.md admin navigation groups). Every item
 * maps to an existing /api/v1/admin/* endpoint; only built screens are links. */
export const NAV: NavGroup[] = [
  { key: "nav.overview", items: [{ key: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard, ready: true }] },
  {
    key: "nav.people",
    items: [
      { key: "nav.users", href: "/users", icon: Users, ready: true },
      { key: "nav.subscriptions", href: "/subscriptions", icon: ShieldCheck, ready: true },
    ],
  },
  {
    key: "nav.content",
    items: [
      { key: "nav.categories", href: "/categories", icon: FolderTree, ready: true },
      { key: "nav.subjects", href: "/subjects", icon: Library, ready: true },
      { key: "nav.questions", href: "/questions", icon: ListChecks, ready: true },
      { key: "nav.exams", href: "/exams", icon: BookOpenCheck, ready: true },
      { key: "nav.attempts", href: "/attempts", icon: Timer, ready: true },
      { key: "nav.results", href: "/results", icon: Trophy, ready: true },
    ],
  },
  {
    key: "nav.commerce",
    items: [
      { key: "nav.packages", href: "/packages", icon: Package, ready: true },
      { key: "nav.payments", href: "/payments", icon: CreditCard, ready: true },
      { key: "nav.gateways", href: "/payment-gateways", icon: Landmark, ready: true },
    ],
  },
  {
    key: "nav.site",
    items: [
      { key: "nav.announcements", href: "/announcements", icon: Megaphone, ready: true },
      { key: "nav.faq", href: "/faqs", icon: HelpCircle, ready: true },
      { key: "nav.pages", href: "/pages", icon: FileText, ready: true },
      { key: "nav.contact", href: "/contact-messages", icon: Mail, ready: true },
      { key: "nav.sms", href: "/sms", icon: Smartphone, ready: true },
      { key: "nav.settings", href: "/settings", icon: Settings, ready: true },
    ],
  },
  { key: "nav.system", items: [{ key: "nav.audit", href: "/audit-log", icon: ScrollText, ready: true }] },
];

export const NAV_ICON_FALLBACK = BarChart3;
