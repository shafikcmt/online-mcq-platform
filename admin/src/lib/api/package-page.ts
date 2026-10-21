import "server-only";

import { notFound } from "next/navigation";

import type { Category } from "@/types/content";
import type { AccessRule, Package } from "@/types/packages";

import { adminLookup } from "./lists";
import { ApiError, adminRead } from "./server";

const PACKAGE_ID = /^\d{1,9}$/;

/** Categories for the access-rules editor (a small reference list, capped). */
export async function packageLookups() {
  const categories = await adminLookup<Category>("/admin/categories/");
  return { categories: categories.rows, lookupTruncated: categories.truncated };
}

/** One package and its COMPLETE access-rule list, in parallel. */
export async function readPackage(rawId: string): Promise<{ pkg: Package; rules: AccessRule[] }> {
  if (!PACKAGE_ID.test(rawId) || Number(rawId) <= 0) notFound();
  const id = Number(rawId);
  try {
    const [pkg, rules] = await Promise.all([
      adminRead<Package>(`/admin/packages/${id}/`),
      adminRead<{ rules: AccessRule[] }>(`/admin/packages/${id}/access-rules/`),
    ]);
    return { pkg, rules: rules.rules };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

/** The package behind a subscriptions filter; `null` when it does not exist. */
export async function readPackageOrNull(id: number): Promise<Package | null> {
  try {
    return await adminRead<Package>(`/admin/packages/${id}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
