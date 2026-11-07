/** Admin subscriptions API (apps/subscriptions/api/serializers.py
 * SubscriptionAdminSerializer). The student's mobile number arrives masked. */
export type StoredSubscriptionStatus = "active" | "expired" | "cancelled";
/** Computed by the server from status, start and expiry at request time. */
export type EffectiveSubscriptionStatus = "active" | "scheduled" | "expired" | "cancelled";
export const EFFECTIVE_SUBSCRIPTION_STATUSES: EffectiveSubscriptionStatus[] = ["active", "scheduled", "expired", "cancelled"];

export type AdminSubscription = {
  id: number;
  user: { id: number; full_name: string; mobile_display: string };
  package: { id: number; slug: string; name_bn: string; name_en: string };
  status: StoredSubscriptionStatus;
  effective_status: EffectiveSubscriptionStatus;
  starts_at: string;
  expires_at: string;
  /** Total paid for this subscription (all periods), decimal string. */
  price_paid: string;
  currency: string;
  /** A test subscription made by a sandbox payment (hidden from lists unless asked for). */
  is_test: boolean;
  created_at: string;
  updated_at: string;
};
