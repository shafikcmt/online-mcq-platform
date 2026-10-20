/** Map a 400 `validation_error` onto a form.
 *
 * The backend sends `field_errors` keyed by field name, each a list of messages. Nested
 * serializers (question options) send a list with one entry per option, e.g.
 * `{"options": [{}, {"text_en": ["Too long"]}]}`, while option-set rules from the service
 * (count, exactly one correct, languages) arrive as plain messages: `{"options": ["…"]}`.
 * Result keys are dotted paths (`options.1.text_en`); messages for fields the form does
 * not show (and `non_field_errors`) go to `form`, so nothing is silently dropped. */
import { ApiError } from "./errors";

export type MappedErrors = { fields: Record<string, string>; form: string[] };

function messages(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function walk(value: unknown, path: string, out: Record<string, string>) {
  if (Array.isArray(value)) {
    const text = messages(value);
    if (text.length) out[path] = text.join(" ");
    value.forEach((item, index) => {
      if (item && typeof item === "object") walk(item, `${path}.${index}`, out);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) walk(nested, path ? `${path}.${key}` : key, out);
    return;
  }
  if (typeof value === "string") out[path] = value;
}

/** `known` = the dotted keys the form renders; a key matches itself or `prefix.*`. */
export function mapFieldErrors(error: unknown, known: (key: string) => boolean): MappedErrors {
  const result: MappedErrors = { fields: {}, form: [] };
  if (!(error instanceof ApiError)) return result;
  const flat: Record<string, string> = {};
  walk(error.fieldErrors, "", flat);
  for (const [key, text] of Object.entries(flat)) {
    if (key !== "non_field_errors" && known(key)) result.fields[key] = text;
    else result.form.push(text);
  }
  return result;
}

export function isValidationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 400 && Object.keys(error.fieldErrors).length > 0;
}

/** Field ids for `aria-describedby`/focus: `options.1.text_en` → `field-options-1-text_en`. */
export function fieldId(key: string): string {
  return `field-${key.replace(/\./g, "-")}`;
}
