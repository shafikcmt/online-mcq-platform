"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/provider";
import { LeaveGuardProvider } from "@/lib/use-unsaved-guard";
import { cn } from "@/lib/utils";

import { SessionExpiredDialog } from "./session-expired";
import { SidebarBrand, SidebarNav } from "./sidebar";
import { Topbar, type AdminProfile } from "./topbar";

const COLLAPSE_KEY = "admin.sidebar.collapsed";

export function AppShell({ profile, children }: { profile: AdminProfile; children: ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        /* preference only */
      }
      return !value;
    });
  }

  return (
    <ToastProvider>
    <LeaveGuardProvider>
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-float"
      >
        {t("nav.skip")}
      </a>

      {/* Desktop sidebar (≥1024px) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <div className={cn("border-t border-line p-3", collapsed && "flex justify-center")}>
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-expanded={!collapsed}
            className={collapsed ? "" : "w-full justify-start"}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            {!collapsed && t("nav.collapse")}
          </Button>
        </div>
      </aside>

      {/* Mobile / tablet drawer (Radix keeps it mounted for the CSS exit animation;
          reduced motion is honoured globally in globals.css). */}
      <Dialog.Portal>
          <Dialog.Overlay className="drawer-overlay fixed inset-0 z-40 bg-ink/40 lg:hidden" />
          <Dialog.Content className="drawer-panel fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col bg-surface shadow-float focus:outline-none lg:hidden">
            <Dialog.Title className="sr-only">{t("nav.main")}</Dialog.Title>
            <Dialog.Description className="sr-only">{t("nav.drawerHint")}</Dialog.Description>
            <div className="flex items-center justify-between pr-3">
              <SidebarBrand />
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t("nav.close")}>
                  <X aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </Dialog.Content>
      </Dialog.Portal>

      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-64")}>
        <Topbar
          profile={profile}
          menuButton={
            <Dialog.Trigger asChild>
              {/* Radix returns focus here when the drawer closes */}
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.open")}>
                <Menu aria-hidden />
              </Button>
            </Dialog.Trigger>
          }
        />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
    </Dialog.Root>
    </LeaveGuardProvider>
    <SessionExpiredDialog />
    </ToastProvider>
  );
}
