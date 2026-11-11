import type { Package } from "./types";

export type CategoryChoice = { slug: string; name: string };

/** The categories the loaded packages cover, in the order they first appear (the server orders them
 * by the admin's category order). Used for the filter chips. */
export function categoriesOf(packages: Package[]): CategoryChoice[] {
  const seen = new Map<string, CategoryChoice>();
  for (const pkg of packages) {
    for (const category of pkg.access?.categories ?? []) {
      if (!seen.has(category.slug)) seen.set(category.slug, { slug: category.slug, name: category.name });
    }
  }
  return [...seen.values()];
}

/** Whether a package belongs under a category filter: it covers that category, or every paid exam. */
export function coversCategory(pkg: Package, slug: string): boolean {
  return pkg.access?.scope === "all" || (pkg.access?.categories.some((category) => category.slug === slug) ?? false);
}
