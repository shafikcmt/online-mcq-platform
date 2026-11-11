import type { Package } from "./api";

/** One block of the packages page: the packages that cover exactly one category (headed by it), or
 * `category: null` for those that cover several categories or every paid exam. */
export type PackageGroup = { category: { slug: string; name: string } | null; packages: Package[] };

/** Group packages by category for the packages page. Groups appear in the order their first package
 * does (the admin's package order), the mixed group last; packages keep their order inside a group.
 * A package that covers nothing yet (no rules, or no open exams) goes to the mixed group too. */
export function groupPackages(packages: Package[]): PackageGroup[] {
  const groups: PackageGroup[] = [];
  const bySlug = new Map<string, PackageGroup>();
  const mixed: PackageGroup = { category: null, packages: [] };
  for (const pkg of packages) {
    const only = pkg.access.scope === "selected" && pkg.access.categories.length === 1 ? pkg.access.categories[0] : null;
    if (!only) {
      mixed.packages.push(pkg);
      continue;
    }
    let group = bySlug.get(only.slug);
    if (!group) {
      group = { category: { slug: only.slug, name: only.name }, packages: [] };
      bySlug.set(only.slug, group);
      groups.push(group);
    }
    group.packages.push(pkg);
  }
  if (mixed.packages.length) groups.push(mixed);
  return groups;
}

/** The "what it covers" line of a card, or "" when it covers nothing yet. */
export function coverageLine(pkg: Package, t: (key: string, values?: Record<string, string | number>) => string, digits: (n: number) => string): string {
  const { scope, exam_count, categories } = pkg.access;
  if (scope === "all") return t("package.coverAll", { n: digits(exam_count) });
  if (!categories.length) return "";
  return t("package.coverSome", { n: digits(exam_count), names: categories.map((c) => c.name).join(", ") });
}
