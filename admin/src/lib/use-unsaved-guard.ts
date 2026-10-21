"use client";

import { useRouter } from "next/navigation";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Warn before leaving a page with unsaved changes.
 *
 * - Reload, closing the tab, typing another address: the browser's own `beforeunload`
 *   prompt (its text cannot be customised).
 * - Any same-origin link on the page (Back link, Cancel, the sidebar, the top bar): the
 *   click is intercepted in the capture phase, before Next.js `<Link>` handles it, and
 *   `pending` is set so the page can ask "Discard unsaved changes?".
 * - Shell actions that are buttons, not links (Sign out): they ask through
 *   `useConfirmLeave`, which reaches the guard of the page that is currently dirty.
 * - Not covered: the browser's Back/Forward buttons. The App Router has no navigation
 *   blocking API and a `popstate` cannot be cancelled without rewriting history, which
 *   this panel deliberately avoids (Milestone 7B). */

/** What the admin was about to do: open a link, or run a shell action (Sign out). */
export type PendingLeave = { href: string } | { action: "signOut"; run: () => void };

/** Set by the guard of a page while it has unsaved changes: asks about `run` and returns
 * true, or returns false when nothing needs asking. */
type Ask = (action: "signOut", run: () => void) => boolean;
const LeaveGuardContext = createContext<{ current: Ask | null } | null>(null);

/** In the app shell, around both the top bar and the page. */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const ask = useRef<Ask | null>(null);
  return createElement(LeaveGuardContext.Provider, { value: ask }, children);
}

/** For shell actions that leave the page: `confirmLeave("signOut", run)` runs `run` now, or
 * — when the current page has unsaved changes — after the admin chooses to discard them. */
export function useConfirmLeave() {
  const ask = useContext(LeaveGuardContext);
  return useCallback(
    (action: "signOut", run: () => void) => {
      if (!ask?.current?.(action, run)) run();
    },
    [ask],
  );
}

export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const leaving = useRef(false);
  const shell = useContext(LeaveGuardContext);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = ""; // older browsers need it set
    }
    function onClick(event: MouseEvent) {
      if (leaving.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // new tab/window
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href: `${url.pathname}${url.search}${url.hash}` });
    }
    const ask: Ask = (action, run) => {
      if (leaving.current) return false;
      setPending({ action, run });
      return true;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    if (shell) shell.current = ask;
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      if (shell?.current === ask) shell.current = null;
    };
  }, [dirty, shell]);

  /** Navigate without asking (after saving, deleting, duplicating). */
  const leave = useCallback(
    (href: string) => {
      leaving.current = true;
      setPending(null);
      router.push(href);
    },
    [router],
  );

  /** "Discard changes": carry out what the admin was about to do. */
  const discard = useCallback(() => {
    if (!pending) return;
    if ("href" in pending) return leave(pending.href);
    leaving.current = true;
    setPending(null);
    pending.run();
  }, [pending, leave]);

  /** Navigate from code (e.g. a Cancel button): asks first when there are changes. */
  const request = useCallback((href: string) => (dirty ? setPending({ href }) : leave(href)), [dirty, leave]);

  return { pending, cancel: () => setPending(null), leave, discard, request };
}
