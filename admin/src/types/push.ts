/** Push notifications (apps/notifications/api/push_views.py). */
/** `announce_new_exams`: a newly published exam is announced once (absent from an older server). */
export type PushStatusInfo = { enabled: boolean; devices: number; reminder_offsets: number[]; announce_new_exams?: boolean };
export type PushMessageState = "pending" | "sending" | "sent" | "failed" | "disabled";
export type PushKind = "manual" | "exam_reminder" | "new_exam";
export type PushMessage = {
  id: number;
  kind: PushKind;
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  exam: number | null;
  exam_label: string;
  reminder_offset: number | null;
  status: PushMessageState;
  device_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
};
export const PUSH_LIMITS = { title: 100, body: 300 } as const;
export type PushExamOption = { id: number; title_bn: string; title_en: string; status: string };
