/** Payment gateway admin API (apps/payments/api/gateway_views.py). Secrets are never part
 * of any response: a credential is only ever `{set, hint}`. */
export type GatewayMode = "sandbox" | "live";
export type GatewayHealthStatus = "untested" | "ok" | "failed" | "unsupported";

export type FieldKind = "text" | "url" | "integer" | "boolean" | "select" | "secret";

export type FieldSpec = {
  name: string;
  kind: FieldKind;
  label_en: string;
  label_bn: string;
  required: boolean;
  default: string | number | boolean | null;
  choices: string[];
  minimum: number | null;
  maximum: number | null;
};

export type Adapter = {
  code: string;
  label_en: string;
  label_bn: string;
  /** false = listed, but no verified adapter exists yet (Nagad, Rocket direct). */
  implemented: boolean;
  capabilities: string[];
  note: string;
  credentials: FieldSpec[];
  options: FieldSpec[];
};

export type CredentialState = { set: boolean; hint: string };

export type Gateway = {
  id: string;
  slug: string;
  adapter: string;
  adapter_label: string;
  implemented: boolean;
  name_en: string;
  name_bn: string;
  description_en: string;
  description_bn: string;
  logo_url: string;
  enabled: boolean;
  mode: GatewayMode;
  priority: number;
  web_enabled: boolean;
  app_enabled: boolean;
  web_return_url: string;
  app_return_url: string;
  currencies: string[];
  min_amount: string | null;
  max_amount: string | null;
  options: Record<string, string | number | boolean>;
  credentials: Record<GatewayMode, Record<string, CredentialState>>;
  /** Why it cannot take payments now (empty = ready). */
  issues: string[];
  /** Why it cannot go live yet (empty when it may, or already live). */
  live_blockers: string[];
  has_sandbox_payment: boolean;
  health: {
    status: GatewayHealthStatus;
    last_test_at: string | null;
    last_connected_at: string | null;
    message: string;
  };
  created_at: string;
  updated_at: string;
};

export type StatBlock = { total: number; success: number; failed: number; pending: number; collected: string };

export type GatewayStats = {
  real: StatBlock;
  sandbox: StatBlock;
  gateways: { id: string; slug: string; adapter: string; live: StatBlock; sandbox: StatBlock }[];
};

export type GatewayLogEntry = {
  id: number;
  event_type: string;
  summary: string;
  details: Record<string, unknown>;
  actor: string;
  created_at: string;
};

export type Tester = { user_id: number; full_name: string; mobile_number: string; added_at: string };

export type ConnectionResult = { supported: boolean; ok: boolean; message: string };
