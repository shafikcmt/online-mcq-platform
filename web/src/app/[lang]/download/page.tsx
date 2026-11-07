import { Download, ShieldCheck, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageIntro } from "@/components/cards";
import { downloadMode, type AppUpdate } from "@/lib/app-download";
import { publicGet, type Settings } from "@/lib/api";
import { isLang, messages, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.downloadTitle"), description: t("meta.downloadDescription"), alternates: alternates(lang, "/download") };
}

function Steps({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="rounded-card border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <ol className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3 text-ink-muted">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Where students get the app and how to install or update it. What it shows follows the
 * download link set in the Admin Panel: an APK file now (install steps, "allow unknown
 * apps"), the Google Play page later (Play steps) — and a "not ready yet" note without one. */
export default async function DownloadPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const m = messages(lang).downloadPage;
  const [settings, update] = await Promise.all([
    publicGet<Settings>("settings/", lang),
    publicGet<AppUpdate>("app-update/", lang),
  ]);
  const url = settings?.app_download_url ?? "";
  const mode = downloadMode(url);
  const version = update?.latest_version ?? "";
  const note = update?.note ?? "";

  return (
    <>
      <PageIntro title={m.title} body={m.body} />
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-16 sm:px-6">
        {mode === "none" ? (
          <section className="max-w-2xl rounded-card border border-line bg-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">{m.soonTitle}</h2>
            <p className="mt-2 text-ink-muted">{m.soonBody}</p>
            <Link href={`/${lang}`} className="mt-4 inline-block font-medium text-brand-700 hover:underline">
              {m.home}
            </Link>
          </section>
        ) : (
          <>
            <section className="max-w-2xl rounded-card border border-line bg-surface p-6 shadow-sm">
              <a
                href={url}
                rel="noopener"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand-600 px-6 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-offset-4"
              >
                {mode === "play" ? <Smartphone className="size-5" aria-hidden /> : <Download className="size-5" aria-hidden />}
                {mode === "play" ? m.buttonPlay : m.button}
              </a>
              {version ? <p className="mt-3 text-sm text-ink-muted">{t("downloadPage.latest", { version })}</p> : null}
              {note ? (
                <div className="mt-4 rounded-control bg-brand-50 p-4 text-sm text-brand-950">
                  <p className="font-semibold">{m.whatsNew}</p>
                  <p className="mt-1 whitespace-pre-line">{note}</p>
                </div>
              ) : null}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              {mode === "apk" ? (
                <>
                  <Steps title={m.stepsTitle} items={m.apk} />
                  <Steps title={m.updateTitle} items={m.updateApk} />
                </>
              ) : (
                <Steps title={m.stepsTitle} items={m.play} />
              )}
            </div>

            <section className="flex max-w-2xl gap-3 rounded-card border border-line bg-surface p-5 text-sm text-ink-muted shadow-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
              <div>
                <h2 className="font-semibold text-ink">{m.safeTitle}</h2>
                <p className="mt-1">{m.safe}</p>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
