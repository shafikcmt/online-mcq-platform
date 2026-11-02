"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { parseListParams, toApiQuery, toUrlQuery, updateListState, type ListSpec } from "./list-params";

type Change = Parameters<typeof updateListState>[1];

/** The list's state comes from the URL — the address bar is the source of truth.
 *
 * `state` is parsed from the App Router's current search params (`useSearchParams()`), not
 * from the server component's props: on Back/Forward, Next.js 15.5 can restore a history
 * entry whose server-rendered props belong to a different query (QA, Milestone 7B), while
 * `useSearchParams()` always matches the URL. Controls, sorting, pagination and the basis
 * of the next navigation all use this URL state; `key` is its canonical identity (the API
 * query, with every parameter in a fixed order).
 *
 * Changes chain from the latest REQUESTED state, so picking two filters quickly (before the
 * first page arrives) keeps both; once the URL changes (our navigation landing, or
 * Back/Forward) the chain restarts from the URL. One canonical URL per state, and a change
 * that leads to the state already requested adds no history entry. */
export function useListUrl(spec: ListSpec) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, startTransition] = useTransition();

  // Parsed from a fresh copy: the router's URLSearchParams object is never touched.
  const state = useMemo(() => parseListParams(new URLSearchParams(search), spec), [search, spec]);
  const key = toApiQuery(state);

  // Latest requested state; restarts from the URL whenever the URL's query changes.
  const latest = useRef(state);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    latest.current = state;
  }

  const update = useCallback(
    (change: Change, { replace = false }: { replace?: boolean } = {}) => {
      const next = updateListState(latest.current, change);
      if (toApiQuery(next) === toApiQuery(latest.current)) return; // nothing changes: no entry
      latest.current = next;
      const href = `${pathname}${toUrlQuery(next, spec)}`;
      startTransition(() => {
        if (replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [pathname, router, spec],
  );

  return { state, key, update, pending };
}
