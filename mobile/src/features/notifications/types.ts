/** `GET /me/notifications/` (student JWT): the student's own notifications, title and
 * message already in the request language. `target` says what to open. */
export type Notification = {
  id: string;
  type: "payment_success" | "result_published";
  title: string;
  message: string;
  target: { type: "payment"; payment_id: string } | { type: "result"; attempt_id: string } | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

/** `GET /announcements/` (student JWT): published notices for students. */
/** `exam`: the published exam a notice is about, or null for a general one (absent from an older server). */
export type Notice = { id: number; exam?: { slug: string; title: string } | null; pdf: { available: boolean; name: string; size_bytes: number }; title: string; body: string; is_pinned: boolean; published_at: string; expires_at: string | null };
