/** The Contact form's own checks, before anything is sent. The backend checks everything
 * again (it is the authority); these only spare the visitor a round trip. */
export type ContactFields = { name: string; phone: string; email: string; subject: string; message: string; website: string };
export type FieldKey = Exclude<keyof ContactFields, "website">;
export type FieldErrors = Partial<Record<FieldKey, string>>;

// The backend's limits (apps/cms/models.py CONTACT_*_MAX_LENGTH; phone: the serializer).
export const LIMITS: Record<FieldKey, number> = { name: 120, phone: 30, email: 254, subject: 150, message: 5000 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Error message keys (`contact.*`) by field; empty when the form may be sent. */
export function validateContact(fields: ContactFields): Partial<Record<FieldKey, "required" | "needContact" | "invalidEmail">> {
  const errors: Partial<Record<FieldKey, "required" | "needContact" | "invalidEmail">> = {};
  for (const key of ["name", "subject", "message"] as const) if (!fields[key].trim()) errors[key] = "required";
  const phone = fields.phone.trim();
  const email = fields.email.trim();
  if (!phone && !email) errors.phone = errors.email = "needContact";
  else if (email && !EMAIL.test(email)) errors.email = "invalidEmail";
  return errors;
}

/** The backend's `{error: {code, message, field_errors}}` → the first message per field we
 * show (anything else falls back to the general message). */
export function serverFieldErrors(body: unknown): FieldErrors {
  const raw = (body as { error?: { field_errors?: Record<string, unknown> } } | null)?.error?.field_errors ?? {};
  const errors: FieldErrors = {};
  for (const key of Object.keys(LIMITS) as FieldKey[]) {
    const value = raw[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first) errors[key] = first;
  }
  return errors;
}
