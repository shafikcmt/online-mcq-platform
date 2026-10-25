/** Admin payments API (apps/payments/api/serializers.py AdminPaymentSerializer /
 * AdminPaymentDetailSerializer). Allow-listed only: the student's mobile number arrives
 * masked; no stored provider answer, event payloads, IP addresses, provider session key,
 * checkout URL or idempotency key ever reach the panel. */
export type PaymentStatus = "initiated" | "pending" | "success" | "failed" | "cancelled";
export const PAYMENT_STATUSES: PaymentStatus[] = ["initiated", "pending", "success", "failed", "cancelled"];

export type PaymentProvider = "mock" | "sslcommerz" | "bkash" | "nagad";
export const PAYMENT_PROVIDERS: PaymentProvider[] = ["sslcommerz", "bkash", "nagad", "mock"];

export type AdminPayment = {
  payment_id: string;
  merchant_reference: string;
  user: { id: number; full_name: string; mobile_display: string };
  package: { id: number; slug: string; name_bn: string; name_en: string };
  /** The subscription this payment created or extended (successful payments only). */
  subscription_id: number | null;
  provider: PaymentProvider;
  /** Decimal string, the price snapshot taken when the payment started. */
  amount: string;
  currency: string;
  status: PaymentStatus;
  /** Server reason code ("" when none); a pending payment may carry one too. */
  failure_reason: string;
  created_at: string;
  verified_at: string | null;
};

/** Four allow-listed facts of the provider's last verification answer. */
export type VerificationSummary = {
  provider_status: string | null;
  risk_level: string | null;
  card_brand: string | null;
  validated_on: string | null;
};

/** Present keys only; every value is a short server code (or a boolean). */
export type EventSummary = Partial<{
  from: string;
  to: string;
  reason: string;
  previous_reason: string;
  outcome: string;
  source: string;
  kind: string;
  signature_valid: boolean;
  error: string;
}>;

export type PaymentEvent = { event_type: string; created_at: string; summary: EventSummary };

export type AdminPaymentDetail = AdminPayment & {
  provider_transaction_id: string | null;
  /** Days of access this payment bought — frozen at checkout, never the package's
   * current validity. */
  validity_days: number;
  updated_at: string;
  last_checked_at: string | null;
  verification: VerificationSummary | null;
  /** The latest events (at most 50), oldest first. */
  events: PaymentEvent[];
  /** All stored events (may be more than shown). */
  events_total: number;
};
