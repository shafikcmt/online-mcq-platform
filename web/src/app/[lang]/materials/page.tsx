import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { MaterialCard } from "@/components/material-card";
import { Pager } from "@/components/pager";
import { publicFetch, publicGet, type Category, type Page } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { apiPath, KINDS, materialsHref, PAGE_SIZE, parseMaterialFilters, type Material } from "@/lib/materials";
import { alternates } from "@/lib/site";

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const filters = parseMaterialFilters(await searchParams);
  return {
    title: t("meta.materialsTitle"),
    description: t("meta.materialsDescription"),
    alternates: alternates(lang, "/materials"),
    robots: filters.kind || filters.category || filters.page > 1 ? { index: false, follow: true } : undefined,
  };
}

const chip = (active: boolean) =>
  cn(
    "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold",
    active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink hover:border-brand-600",
  );

/** Study materials: YouTube videos (played on demand) and PDF handouts, filtered by type and
 * category in the address, rendered on the server and working without JavaScript. */
export default async function MaterialsPage({ params, searchParams }: Props) {
  const lang = (await params).lang;
  if (!isLang(lang)) notFound();
  const t = translator(lang as Lang);
  const filters = parseMaterialFilters(await searchParams);
  const [fetched, categories] = await Promise.all([
    publicFetch<Page<Material>>(apiPath(filters), lang as Lang),
    publicGet<Page<Category>>("categories/?page_size=100", lang as Lang),
  ]);
  const list = fetched.state === "ok" ? fetched.data : fetched.state === "missing" ? { count: 0, next: null, previous: null, results: [] } : null;
  const filtered = Boolean(filters.kind || filters.category);

  return (
    <>
      <PageIntro title={t("materials.title")} body={t("materials.body")} />
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <nav aria-label={t("materials.types")} className="flex flex-wrap gap-2">
          <Link href={materialsHref(lang, { category: filters.category })} className={chip(!filters.kind)} aria-current={!filters.kind ? "page" : undefined}>
            {t("materials.allTypes")}
          </Link>
          {KINDS.map((kind) => (
            <Link key={kind} href={materialsHref(lang, { kind, category: filters.category })} className={chip(filters.kind === kind)} aria-current={filters.kind === kind ? "page" : undefined}>
              {t(`materials.${kind}`)}
            </Link>
          ))}
        </nav>
        {categories && categories.results.length > 0 ? (
          <nav aria-label={t("materials.categories")} className="mt-3 flex flex-wrap gap-2">
            <Link href={materialsHref(lang, { kind: filters.kind })} className={chip(!filters.category)} aria-current={!filters.category ? "page" : undefined}>
              {t("materials.all")}
            </Link>
            {categories.results.map((category) => (
              <Link
                key={category.slug}
                href={materialsHref(lang, { kind: filters.kind, category: category.slug })}
                className={chip(filters.category === category.slug)}
                aria-current={filters.category === category.slug ? "page" : undefined}
              >
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="mt-8">
          {list === null ? (
            <UnavailableNote text={t("materials.unavailable")} />
          ) : list.results.length === 0 ? (
            <div className="space-y-3">
              <EmptyNote text={t(filtered ? "materials.emptyFiltered" : "materials.empty")} />
              {filtered ? (
                <p className="text-center">
                  <Link href={materialsHref(lang, {})} className="text-sm font-semibold text-brand-700 hover:underline">
                    {t("materials.clear")}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {list.results.map((material) => (
                <li key={material.id}>
                  <MaterialCard material={material} lang={lang as Lang} />
                </li>
              ))}
            </ul>
          )}
          {list ? <Pager lang={lang as Lang} t={t} page={filters.page} pages={Math.max(1, Math.ceil(list.count / PAGE_SIZE))} href={(n) => materialsHref(lang, { ...filters, page: n })} /> : null}
        </div>
      </div>
    </>
  );
}
