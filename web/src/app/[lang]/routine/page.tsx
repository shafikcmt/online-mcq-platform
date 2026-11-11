import { Download } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyNote, PageIntro, UnavailableNote } from "@/components/cards";
import { RoutineSchedule } from "@/components/routine-schedule";
import { publicGet } from "@/lib/api";
import { isLang, translator, type Lang } from "@/lib/i18n";
import type { RoutineResponse } from "@/lib/routine";
import { alternates } from "@/lib/site";

export const revalidate = 60;

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.routineTitle"), description: t("meta.routineDescription"), alternates: alternates(lang, "/routine") };
}

/** The exam routine: every scheduled exam that has not ended, by day, with the routine PDF
 * when the admin has published one. The PDF is served by the API on this same address. */
export default async function RoutinePage({ params }: Props) {
  const lang = (await params).lang;
  if (!isLang(lang)) notFound();
  const t = translator(lang as Lang);
  const routine = await publicGet<RoutineResponse>("routine/", lang as Lang);
  return (
    <>
      <PageIntro title={t("routine.title")} body={t("routine.body")}>
        {routine?.pdf.available ? (
          <a
            href="/api/v1/public/routine/pdf/"
            target="_blank"
            rel="noopener"
            className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-600 px-5 font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            <Download className="size-5" aria-hidden />
            {t("routine.download")}
          </a>
        ) : null}
      </PageIntro>
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        {routine === null ? (
          <UnavailableNote text={t("routine.unavailable")} />
        ) : routine.exams.length === 0 ? (
          <EmptyNote text={t("routine.empty")} />
        ) : (
          <RoutineSchedule exams={routine.exams} lang={lang as Lang} t={t} now={Date.now()} />
        )}
      </div>
    </>
  );
}
