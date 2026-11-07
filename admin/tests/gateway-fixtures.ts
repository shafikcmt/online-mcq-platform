import type { Adapter, Gateway, GatewayStats, StatBlock } from "@/types/gateways";

const STAMP = "2026-11-01T08:00:00Z";

export const bkashAdapter: Adapter = {
  code: "bkash",
  label_en: "bKash (Tokenized Checkout)",
  label_bn: "বিকাশ",
  implemented: true,
  capabilities: ["initiate", "verify", "test_connection"],
  note: "",
  credentials: ["app_key", "app_secret", "username", "password"].map((name) => ({
    name,
    kind: "secret" as const,
    label_en: name.replace("_", " "),
    label_bn: name,
    required: true,
    default: null,
    choices: [],
    minimum: null,
    maximum: null,
  })),
  options: [
    { name: "api_version", kind: "text", label_en: "API version", label_bn: "ভার্সন", required: false, default: "v1.2.0-beta", choices: [], minimum: null, maximum: null },
    { name: "timeout_seconds", kind: "integer", label_en: "Request timeout (seconds)", label_bn: "টাইমআউট", required: false, default: 15, choices: [], minimum: 3, maximum: 60 },
  ],
};

export const nagadAdapter: Adapter = { ...bkashAdapter, code: "nagad", label_en: "Nagad", label_bn: "নগদ", implemented: false, capabilities: [], credentials: [], options: [] };

const none = { set: false, hint: "" };
export const gateway = (overrides: Partial<Gateway> = {}): Gateway => ({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "bkash-main",
  adapter: "bkash",
  adapter_label: "bKash (Tokenized Checkout)",
  implemented: true,
  name_en: "bKash",
  name_bn: "বিকাশ",
  description_en: "",
  description_bn: "",
  logo_url: "",
  enabled: false,
  mode: "sandbox",
  priority: 10,
  web_enabled: true,
  app_enabled: true,
  web_return_url: "",
  app_return_url: "",
  currencies: ["BDT"],
  min_amount: null,
  max_amount: null,
  options: { api_version: "v1.2.0-beta", timeout_seconds: 15 },
  credentials: {
    sandbox: { app_key: none, app_secret: { set: true, hint: "0001" }, username: none, password: none },
    live: { app_key: none, app_secret: none, username: none, password: none },
  },
  issues: ["missing_credential:app_key"],
  live_blockers: ["missing_credential:app_key", "no_successful_sandbox_payment"],
  has_sandbox_payment: false,
  health: { status: "untested", last_test_at: null, last_connected_at: null, message: "" },
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
});

const block = (overrides: Partial<StatBlock> = {}): StatBlock => ({ total: 0, success: 0, failed: 0, pending: 0, collected: "0.00", ...overrides });
export const stats = (overrides: Partial<GatewayStats> = {}): GatewayStats => ({
  real: block({ total: 4, success: 3, failed: 1, collected: "1500.00" }),
  sandbox: block({ total: 2, success: 1, collected: "500.00" }),
  gateways: [{ id: "11111111-1111-4111-8111-111111111111", slug: "bkash-main", adapter: "bkash", live: block({ total: 4, success: 3, collected: "1500.00" }), sandbox: block({ total: 2, success: 1 }) }],
  ...overrides,
});
