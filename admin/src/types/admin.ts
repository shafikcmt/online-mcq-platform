/** Shapes of the existing backend responses (see the backend api serializers). */
export type AdminDashboard = {
  server_time: string;
  period: {
    time_zone: string;
    today_start: string;
    today_end: string;
    month_start: string;
    month_end: string;
  };
  users: { students_total: number; students_active: number };
  exams: {
    total: number;
    draft: number;
    published: number;
    unpublished: number;
    archived: number;
    open_now: number;
    upcoming: number;
  };
  attempts: { started_today: number; submitted_today: number; in_progress: number };
  subscriptions: { active_now: number; students_with_active: number };
  payments: {
    by_status: Record<"initiated" | "pending" | "success" | "failed" | "cancelled", number>;
    success_this_month: number;
    revenue_this_month: { currency: string; amount: string }[];
  };
};
