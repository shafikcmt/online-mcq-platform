import type { Currency, Package, PackageStatus } from "@/types/packages";

/** Package editor state and its conversion to the API payload. Inputs hold what the
 * admin typed; the server validates everything (apps/subscriptions/services.py) and
 * answers with field errors. Features are edited as one line per feature. */
export type PackageDraft = {
  name_bn: string;
  name_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  features_bn: string;
  features_en: string;
  price: string;
  currency: Currency;
  validity_days: string;
  status: PackageStatus;
  sort_order: string;
  is_featured: boolean;
};

/** Fields the form shows (server error keys mapped onto them). */
export const PACKAGE_FIELDS = new Set<string>([
  "name_bn",
  "name_en",
  "slug",
  "description_bn",
  "description_en",
  "features_bn",
  "features_en",
  "price",
  "currency",
  "validity_days",
  "status",
  "sort_order",
  "is_featured",
]);

export function newPackageDraft(): PackageDraft {
  return {
    name_bn: "",
    name_en: "",
    slug: "",
    description_bn: "",
    description_en: "",
    features_bn: "",
    features_en: "",
    price: "",
    currency: "BDT",
    validity_days: "",
    status: "active",
    sort_order: "",
    is_featured: false,
  };
}

export function draftFromPackage(pkg: Package): PackageDraft {
  return {
    name_bn: pkg.name_bn,
    name_en: pkg.name_en,
    slug: pkg.slug,
    description_bn: pkg.description_bn,
    description_en: pkg.description_en,
    features_bn: pkg.features_bn.join("\n"),
    features_en: pkg.features_en.join("\n"),
    price: pkg.price,
    currency: pkg.currency,
    validity_days: String(pkg.validity_days),
    status: pkg.status,
    sort_order: String(pkg.sort_order),
    is_featured: pkg.is_featured,
  };
}

export function samePackageDraft(a: PackageDraft, b: PackageDraft): boolean {
  return (Object.keys(a) as (keyof PackageDraft)[]).every((key) => a[key] === b[key]);
}

const lines = (text: string) => text.split("\n");
/** Whole numbers are sent as numbers; anything else as typed, for the server to report. */
const integer = (text: string) => (/^\d{1,10}$/.test(text.trim()) ? Number(text.trim()) : text);

/** `status` is sent on create only: an existing package changes status through the
 * Activate/Deactivate actions (with their confirmation). */
export function toPackagePayload(draft: PackageDraft, { isNew }: { isNew: boolean }): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name_bn: draft.name_bn,
    name_en: draft.name_en,
    slug: draft.slug,
    description_bn: draft.description_bn,
    description_en: draft.description_en,
    features_bn: lines(draft.features_bn),
    features_en: lines(draft.features_en),
    price: draft.price.trim(),
    currency: draft.currency,
    validity_days: integer(draft.validity_days),
    is_featured: draft.is_featured,
  };
  if (draft.sort_order.trim()) payload.sort_order = integer(draft.sort_order);
  if (isNew) payload.status = draft.status;
  return payload;
}

/** Server error keys → form fields: list items (`features_en.2`) belong to their list. */
export function packageFieldErrors(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields)) {
    const base = key.split(".")[0];
    out[base] = out[base] ? `${out[base]} ${message}` : message;
  }
  return out;
}
