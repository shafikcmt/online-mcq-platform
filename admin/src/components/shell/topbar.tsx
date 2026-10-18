"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Languages, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo";
import { apiFetch } from "@/lib/api/client";
import { LOCALES, type Locale } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";

export type AdminProfile = {
  full_name: string;
  mobile_number: string;
  preferred_language: string;
  role: string;
};

const MENU_CONTENT =
  "menu-panel z-50 min-w-56 rounded-card border border-line bg-surface p-1.5 shadow-float";
const MENU_ITEM =
  "flex h-9 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-neutral-50 data-[disabled]:opacity-60";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Topbar({ profile, menuButton }: { profile: AdminProfile; menuButton: ReactNode }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [, startTransition] = useTransition();

  function setLocale(next: Locale) {
    document.cookie = `admin_lang=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch("/admin/auth/logout/", { method: "POST" });
    } catch {
      /* the session is ended or unreachable either way: go to the sign-in page */
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      {menuButton}
      <LogoMark className="size-8 lg:hidden" />
      <div className="ml-auto flex items-center gap-1.5">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-control px-2.5 text-sm text-ink-muted hover:bg-neutral-50 hover:text-ink"
              aria-label={t("lang.label")}
            >
              <Languages className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t(locale === "bn" ? "lang.bn" : "lang.en")}</span>
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={6} className={MENU_CONTENT}>
              <Dropdown.Label className="px-2.5 py-1.5 text-xs text-ink-subtle">{t("lang.label")}</Dropdown.Label>
              {LOCALES.map((code) => (
                <Dropdown.Item key={code} className={MENU_ITEM} onSelect={() => setLocale(code)} lang={code}>
                  <Check className={`size-4 ${code === locale ? "text-brand-600" : "invisible"}`} aria-hidden />
                  {t(code === "bn" ? "lang.bn" : "lang.en")}
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={t("user.menu")}
              className="inline-flex h-10 items-center gap-2.5 rounded-control py-1 pr-2 pl-1 hover:bg-neutral-50"
            >
              <span className="grid size-8 place-items-center rounded-full bg-brand-800 text-xs font-semibold text-white">
                {initials(profile.full_name) || "A"}
              </span>
              <span className="hidden min-w-0 text-left md:block">
                <span className="block max-w-40 truncate text-sm font-medium text-ink">{profile.full_name}</span>
                <span className="block text-xs text-ink-subtle">{profile.mobile_number}</span>
              </span>
              <ChevronDown className="hidden size-4 text-ink-subtle md:block" aria-hidden />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={6} className={MENU_CONTENT}>
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium text-ink">{profile.full_name}</p>
                <p className="text-xs text-ink-subtle">{profile.mobile_number}</p>
              </div>
              <Dropdown.Separator className="my-1 h-px bg-line" />
              <Dropdown.Item className={MENU_ITEM} onSelect={signOut} disabled={signingOut}>
                <LogOut className="size-4 text-ink-subtle" aria-hidden />
                {signingOut ? t("user.signingOut") : t("user.signOut")}
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </header>
  );
}
