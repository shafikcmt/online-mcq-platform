/** `GET /packages/` (student JWT): the public package fields, the `id` to buy with and
 * the student's own current subscription to it. Money is a decimal string. */
export type Package = {
  id: number;
  slug: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currency: string;
  validity_days: number;
  is_featured: boolean;
  /** What it unlocks: every paid exam, or the listed categories (paid exams open now). */
  /** Absent from a server that has not been updated yet: treated as unknown, never an error. */
  access?: PackageAccess;
  subscription: { active_now: boolean; expires_at: string } | null;
};

export type PackageAccess = {
  scope: "all" | "selected";
  exam_count: number;
  categories: { slug: string; name: string; exam_count: number }[];
};

export type PaymentStatus = "pending" | "success" | "failed" | "cancelled";

/** `POST /payments/`, `GET /payments/{id}/`: the student's own payment. Never provider
 * payloads. `checkout_url` only while pending; `transaction_id` only on success. */
export type Payment = {
  payment_id: string;
  merchant_reference: string;
  status: PaymentStatus;
  provider: string;
  /** A sandbox payment by a designated tester (a test subscription, not a real one). */
  is_test: boolean;
  amount: string;
  currency: string;
  package: { slug: string; name: string };
  checkout_url: string | null;
  transaction_id: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** `GET /payments/methods/?channel=app`: one way to pay. `gateway` (the merchant account's
 * identifier) is what is sent back when buying; `provider` is the adapter (bkash, sslcommerz…).
 * `is_test` marks a sandbox gateway shown to a designated tester. Limits are decimal strings. */
export type PaymentMethod = {
  provider: string;
  gateway: string;
  label: string;
  name: string;
  description: string;
  logo_url: string;
  min_amount: string | null;
  max_amount: string | null;
  is_test: boolean;
};
