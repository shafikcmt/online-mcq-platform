import { api } from "@/api/client";
import type { Page } from "@/lib/use-pages";

import type { Notice, Notification } from "./types";

export function fetchNotifications(page: number) {
  return api<Page<Notification>>(`/me/notifications/?page=${page}&page_size=20`);
}

export function markRead(id: string) {
  return api<Notification>(`/me/notifications/${encodeURIComponent(id)}/read/`, { method: "POST", body: {} });
}

export function markAllRead() {
  return api<{ updated: number }>("/me/notifications/read-all/", { method: "POST", body: {} });
}

export function fetchNotices(page: number) {
  return api<Page<Notice>>(`/announcements/?page=${page}&page_size=20`);
}
