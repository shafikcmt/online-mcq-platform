"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Paginated } from "@/types/content";

import { apiFetch } from "./api/client";
import { ApiError } from "./api/errors";
import { toApiQuery, type ListState } from "./list-params";

/** Which rows a list screen shows. Identity is the URL's list query (`urlKey`, from
 * `useListUrl`), never an object reference.
 *
 * Rules, in order:
 * 1. A page read from the API for exactly `urlKey` (after a save/delete, or to repair a
 *    mismatch — see 3) is shown while `urlKey` stays the same. Only the LATEST read, and
 *    only one still for the current key, is applied; a slow read for an old query never
 *    overwrites a newer one.
 * 2. Otherwise the server-rendered page is shown — but only if it was rendered for
 *    `urlKey`. It is authoritative whenever the URL changes (filters, page, Back/Forward):
 *    any earlier read is discarded at once.
 * 3. If the server-rendered page belongs to ANOTHER query, its rows are not shown: `data`
 *    is null and the view shows a loading state. On Back/Forward, Next.js 15.5 first
 *    renders the restored entry with the previous query's server props and fetches the
 *    right ones (QA, Milestone 7B: 27–196 ms); rarely they never arrive. So the URL's page
 *    is also read from the API: cancelled as soon as the matching server render lands,
 *    otherwise shown (followed by one background `router.refresh()`).
 *
 * Saves/deletes call `reload()` (rule 1) instead of relying on `router.refresh()` alone:
 * with Next.js 15.5 a refresh of the same URL intermittently stays uncommitted until some
 * unrelated update (React root left with a suspended, never-pinged transition lane). */
export function useListData<T>({
  serverData,
  serverState,
  urlKey,
  apiPath,
  onPageGone,
}: {
  serverData: Paginated<T>;
  /** The state the server component rendered `serverData` for. */
  serverState: ListState;
  /** Canonical query of the URL (`useListUrl().key`). */
  urlKey: string;
  apiPath: string;
  /** The current page no longer exists (e.g. its last row was deleted): go to page 1. */
  onPageGone: () => void;
}) {
  const router = useRouter();
  const serverKey = toApiQuery(serverState);
  const [read, setRead] = useState<{ key: string; data: Paginated<T> } | null>(null);
  const [reading, setReading] = useState(false);
  const latestRequest = useRef(0);
  const currentKey = useRef(urlKey);
  currentKey.current = urlKey;
  // Held in a ref so `readPage` keeps one identity (a repair read must not restart because
  // a caller passed a new callback).
  const onPageGoneRef = useRef(onPageGone);
  useEffect(() => {
    onPageGoneRef.current = onPageGone;
  }, [onPageGone]);

  // Rule 2: a new URL query discards any earlier read (and invalidates reads in flight).
  const [seenKey, setSeenKey] = useState(urlKey);
  if (seenKey !== urlKey) {
    setSeenKey(urlKey);
    setRead(null);
  }

  const serverMatches = serverKey === urlKey;
  const data = read && read.key === urlKey ? read.data : serverMatches ? serverData : null;

  const readPage = useCallback(
    async (key: string, page: number, signal?: AbortSignal) => {
      const request = ++latestRequest.current;
      setReading(true);
      try {
        const fresh = await apiFetch<Paginated<T>>(`${apiPath}${key}`, { signal });
        if (request === latestRequest.current && currentKey.current === key) setRead({ key, data: fresh });
      } catch (error) {
        if (signal?.aborted) {
          // A repair read made unnecessary (the server render caught up, or the URL moved on).
          if (request === latestRequest.current) setReading(false);
          return;
        }
        if (error instanceof ApiError && error.status === 404 && page > 1 && currentKey.current === key) {
          if (request === latestRequest.current) setReading(false);
          onPageGoneRef.current(); // navigation to another url
          return;
        }
        // Network/session errors: keep what is shown; the refresh below may still land.
      }
      if (request === latestRequest.current) setReading(false);
      router.refresh(); // background: re-sync the server-rendered page
    },
    [apiPath, router],
  );

  // Rule 3: the server render is for another query — read the URL's page. Usually Next.js
  // brings the matching server render itself moments later (Back/Forward restore); the
  // read is then cancelled, so it only ever matters when the server render does not come.
  const needsRepair = !serverMatches && !(read && read.key === urlKey);
  const page = Number(new URLSearchParams(urlKey).get("page") ?? 1);
  useEffect(() => {
    if (!needsRepair) return;
    const controller = new AbortController();
    void readPage(urlKey, page, controller.signal);
    return () => controller.abort();
  }, [needsRepair, urlKey, page, readPage]);

  /** After a successful save/delete: re-read the current page (rule 1). */
  const reload = useCallback(() => readPage(urlKey, page), [readPage, urlKey, page]);

  /** Identities for tests/diagnostics (rendered as data-* attributes on the list). */
  const identity = {
    "data-list-query": serverKey,
    "data-url-query": urlKey,
    "data-reread-query": read?.key ?? "",
  };

  return { data, reload, reloading: reading || data === null, identity };
}
