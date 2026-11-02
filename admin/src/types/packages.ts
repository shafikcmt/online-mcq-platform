/** Admin packages API (apps/subscriptions/api/serializers.py PackageAdminSerializer). */
export type PackageStatus = "active" | "inactive";
export const PACKAGE_STATUSES: PackageStatus[] = ["active", "inactive"];
export type Currency = "BDT";
export const CURRENCIES: Currency[] = ["BDT"];

export type Package = {
  id: number;
  name_bn: string;
  name_en: string;
  slug: string;
  description_bn: string;
  description_en: string;
  features_bn: string[];
  features_en: string[];
  /** Decimal string, e.g. "500.00". */
  price: string;
  currency: Currency;
  validity_days: number;
  /** inactive = no new sales or grants; existing subscriptions keep their access. */
  status: PackageStatus;
  sort_order: number;
  is_featured: boolean;
  rule_count: number;
  subscription_count: number;
  created_at: string;
  updated_at: string;
};

export type RuleType = "all_paid_exams" | "category" | "exam";

/** One access rule as GET /admin/packages/{id}/access-rules/ returns it. */
export type AccessRule = {
  rule_type: RuleType;
  category: { id: number; slug: string; name_bn: string; name_en: string } | null;
  exam: { id: number; slug: string; title_bn: string; title_en: string; access_type: string; status: string } | null;
};

/** What PATCH …/access-rules/ takes: the COMPLETE list. */
export type AccessRuleInput = { rule_type: RuleType; category?: number; exam?: number };
