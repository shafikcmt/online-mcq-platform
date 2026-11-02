"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo, LogoMark } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { NAV } from "./nav";

const HAS_PENDING = NAV.some((group) => group.items.some((item) => !item.ready));

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label={t("nav.main")} className="flex-1 overflow-y-auto px-3 pb-6">
      {NAV.map((group) => (
        <div key={group.key} className="mt-5 first:mt-2">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">
              {t(group.key)}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const label = t(item.key);
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const base = cn(
                "group flex h-9 items-center gap-3 rounded-control px-2.5 text-sm",
                collapsed && "justify-center px-0",
              );
              if (!item.ready) {
                return (
                  <li key={item.key}>
                    <span
                      aria-disabled="true"
                      title={`${label} — ${t("nav.soonHint")}`}
                      className={cn(base, "cursor-not-allowed text-ink-subtle/70")}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{label}</span>}
                      <span className="sr-only">{collapsed ? `${label} (${t("nav.soon")})` : ` (${t("nav.soon")})`}</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      base,
                      "font-medium transition-colors",
                      active
                        ? "bg-brand-50 text-brand-800"
                        : "text-ink-muted hover:bg-neutral-50 hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-[18px] shrink-0", active ? "text-brand-600" : "")} aria-hidden />
                    {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {/* Only while some area is still marked "Soon" (none are now; kept for future areas). */}
      {!collapsed && HAS_PENDING && <p className="mt-6 px-2.5 text-xs leading-relaxed text-ink-subtle">{t("nav.pendingNote")}</p>}
    </nav>
  );
}

export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn("flex h-16 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
      {collapsed ? (
        <LogoMark className="size-9" title={t("brand.name")} />
      ) : (
        <Link href="/dashboard" className="flex items-center gap-2 rounded-control" aria-label={t("brand.name")}>
          <Logo />
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
            {t("brand.area")}
          </span>
        </Link>
      )}
    </div>
  );
}
