import type { Locale, MessageKey } from "@/lib/i18n/messages";
import type { Adapter, FieldSpec, Gateway } from "@/types/gateways";

/** Pure helpers for the gateway screens (no React): drafts, the changed-fields body, and
 * the text for the server's stable issue / blocker / test codes. */

export const CURRENCIES = ["BDT"];

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const fieldLabel = (field: FieldSpec, locale: Locale) =>
  locale === "bn" && field.label_bn ? field.label_bn : field.label_en;

export const adapterLabel = (adapter: Adapter | undefined, fallback: string, locale: Locale) =>
  adapter ? (locale === "bn" && adapter.label_bn ? adapter.label_bn : adapter.label_en) : fallback;

export const gatewayName = (gateway: Gateway, locale: Locale) =>
  locale === "bn" && gateway.name_bn ? gateway.name_bn : gateway.name_en;

// ---------------------------------------------------------------------------------------
// Settings draft (everything but secrets)
// ---------------------------------------------------------------------------------------
export type SettingsDraft = {
  name_en: string;
  name_bn: string;
  description_en: string;
  description_bn: string;
  logo_url: string;
  priority: string;
  web_enabled: boolean;
  app_enabled: boolean;
  web_return_url: string;
  app_return_url: string;
  currencies: string[];
  min_amount: string;
  max_amount: string;
  /** Adapter options as typed in (text), booleans as booleans. */
  options: Record<string, string | boolean>;
};

const optionText = (value: unknown): string | boolean =>
  typeof value === "boolean" ? value : value === null || value === undefined ? "" : String(value);

export function settingsDraft(gateway: Gateway, adapter: Adapter | undefined): SettingsDraft {
  const options: Record<string, string | boolean> = {};
  for (const field of adapter?.options ?? []) options[field.name] = optionText(gateway.options[field.name] ?? field.default);
  return {
    name_en: gateway.name_en,
    name_bn: gateway.name_bn,
    description_en: gateway.description_en,
    description_bn: gateway.description_bn,
    logo_url: gateway.logo_url,
    priority: String(gateway.priority),
    web_enabled: gateway.web_enabled,
    app_enabled: gateway.app_enabled,
    web_return_url: gateway.web_return_url,
    app_return_url: gateway.app_return_url,
    currencies: [...gateway.currencies],
    min_amount: gateway.min_amount ?? "",
    max_amount: gateway.max_amount ?? "",
    options,
  };
}

/** The value of one adapter option as the API wants it (integers as numbers). */
export function coerceOption(field: FieldSpec, raw: string | boolean): string | number | boolean {
  if (field.kind === "boolean") return Boolean(raw);
  if (field.kind === "integer") {
    const text = String(raw).trim();
    return /^-?\d+$/.test(text) ? Number(text) : text; // a non-number is left for the server to refuse
  }
  return String(raw).trim();
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Only what the admin changed (PATCH). Empty = nothing to save. */
export function settingsChanges(gateway: Gateway, draft: SettingsDraft, adapter: Adapter | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const text = ["name_en", "name_bn", "description_en", "description_bn", "logo_url", "web_return_url", "app_return_url"] as const;
  for (const key of text) if (draft[key].trim() !== gateway[key]) body[key] = draft[key].trim();
  for (const key of ["web_enabled", "app_enabled"] as const) if (draft[key] !== gateway[key]) body[key] = draft[key];
  const priority = draft.priority.trim();
  if (priority !== String(gateway.priority)) body.priority = /^\d+$/.test(priority) ? Number(priority) : priority;
  if (!sameList(draft.currencies, gateway.currencies)) body.currencies = draft.currencies;
  for (const key of ["min_amount", "max_amount"] as const) {
    const current = gateway[key] ?? "";
    if (draft[key].trim() !== current) body[key] = draft[key].trim() === "" ? null : draft[key].trim();
  }
  const options: Record<string, unknown> = {};
  let optionsChanged = false;
  for (const field of adapter?.options ?? []) {
    const value = coerceOption(field, draft.options[field.name] ?? "");
    options[field.name] = value;
    if (value !== (gateway.options[field.name] ?? field.default)) optionsChanged = true;
  }
  if (optionsChanged) body.options = options;
  return body;
}

// ---------------------------------------------------------------------------------------
// Secrets: only what was typed is sent
// ---------------------------------------------------------------------------------------
export function typedCredentials(typed: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(typed).filter(([, value]) => value.trim() !== "").map(([k, v]) => [k, v.trim()]));
}

// ---------------------------------------------------------------------------------------
// Stable server codes → text
// ---------------------------------------------------------------------------------------
const SIMPLE_ISSUES = new Set(["adapter_not_implemented", "credentials_unreadable", "encryption_unavailable", "no_successful_sandbox_payment"]);

/** "missing_credential:app_key" → "Missing credential: App key"; unknown codes read as generic. */
export function issueText(code: string, adapter: Adapter | undefined, locale: Locale, t: Translate): string {
  if (code.startsWith("missing_credential:")) {
    const name = code.split(":")[1] ?? "";
    const field = adapter?.credentials.find((f) => f.name === name);
    return t("gw.issue.missing_credential", { name: field ? fieldLabel(field, locale) : name });
  }
  return SIMPLE_ISSUES.has(code) ? t(`gw.issue.${code}` as MessageKey) : t("gw.issue.unknown");
}

const TEST_MESSAGES = new Set(["token_granted", "connection_test_not_supported", "timeout", "network_error", "token_refused", "http_401", "not_configured"]);

export function testMessage(message: string, adapter: Adapter | undefined, locale: Locale, t: Translate): string {
  if (!message) return "";
  // A gateway that is not ready is reported with its issue code, without calling the provider.
  if (message.startsWith("missing_credential:") || SIMPLE_ISSUES.has(message)) return issueText(message, adapter, locale, t);
  if (TEST_MESSAGES.has(message)) return t(`gw.testMsg.${message}` as MessageKey);
  return t("gw.testMsg.other", { code: message.slice(0, 40) });
}

const LOG_TYPES = new Set(["created", "config_changed", "credential_changed", "mode_changed", "enabled", "disabled", "connection_test", "error"]);
export const logTypeLabel = (type: string, t: Translate) => (LOG_TYPES.has(type) ? t(`gw.log.${type}` as MessageKey) : type);
