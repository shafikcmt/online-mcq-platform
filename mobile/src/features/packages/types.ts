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
  subscription: { active_now: boolean; expires_at: string } | null;
};

export type PaymentStatus = "pending" | "success" | "failed" | "cancelled";

/** `POST /payments/`, `GET /payments/{id}/`: the student's own payment. Never provider
 * payloads. `checkout_url` only while pending; `transaction_id` only on success. */
export type Payment = {
  payment_id: string;
  merchant_reference: string;
  status: PaymentStatus;
  provider: string;
  amount: string;
  currency: string;
  package: { slug: string; name: string };
  checkout_url: string | null;
  transaction_id: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** `GET /payments/methods/`: one way to pay (`provider` is the code sent back when buying). */
export type PaymentMethod = { provider: string; label: string };
