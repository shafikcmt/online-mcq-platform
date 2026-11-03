/** SMS gateway admin API (apps/verification/sms_admin.py). The API key is never returned. */
export type SmsNumberFormat = "with_plus" | "without_plus" | "local";

export type SmsPreset = {
  label: string;
  api_url: string;
  number_format: SmsNumberFormat;
  request_template: Record<string, string>;
  success_codes: string[];
  retry_codes: string[];
  code_field: string;
};

export type SmsGateway = {
  enabled: boolean;
  api_url: string;
  sender_id: string;
  number_format: SmsNumberFormat;
  request_template: Record<string, string>;
  success_codes: string[];
  retry_codes: string[];
  code_field: string;
  has_api_key: boolean;
  api_key_hint: string;
  secret_storage_ready: boolean;
  active_provider: string;
  presets: Record<string, SmsPreset>;
};
