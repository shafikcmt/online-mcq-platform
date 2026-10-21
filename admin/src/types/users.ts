/** Admin Users API rows (apps/accounts/api/admin_users.py). Read-only; personal data
 * arrives masked — the panel never receives a full mobile number or email. */
export type UserRole = "student" | "admin";
export const USER_ROLES: UserRole[] = ["student", "admin"];

export type AdminUser = {
  id: number;
  full_name: string;
  /** Student-chosen nickname ("" when none, always "" for admins). */
  display_name: string;
  role: UserRole;
  preferred_language: string;
  is_active: boolean;
  is_mobile_verified: boolean;
  /** Masked, e.g. "+88017*****678". */
  mobile_display: string;
  /** Masked, e.g. "r***@g***.com"; null when the user has no email. */
  email_display: string | null;
  date_joined: string;
  updated_at: string;
};

export type AdminUserDetail = AdminUser & {
  attempts_count: number;
  results_count: number;
  /** Started and not expired (the subscriptions module's own rule). */
  active_subscriptions_count: number;
  payments_count: number;
};
