import { CalendarClock, ChevronLeft, Clock3, FileQuestion, Languages, MinusCircle, Target, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppButton } from "@/components/app-button";
import { Chip, PageIntro, UnavailableNote } from "@/components/cards";
import { getSettings, publicFetch, publicGet, type Exam, type LeaderboardRow } from "@/lib/api";
import { pageHref, scheduleState } from "@/lib/exam-filters";
import { dateTime, decimal, digits } from "@/lib/format";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

type Props = { params: Promise<{ lang: string; slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The exam from the public API; a slug that cannot exist is "missing" without a request. */
async function load(slug: string, lang: Lang) {
  if (slug.length > 140 || !SLUG.test(slug)) return { state: "missing" as const };
  return publicFetch<Exam>(`exams/${slug}/`, lang);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  const fetched = await load(slug, lang);
  if (fetched.state !== "ok") return { title: t("meta.examsTitle"), robots: { index: false } };
  const exam = fetched.data;
  return {
    title: exam.title,
    description:
      exam.description.slice(0, 200) ||
      t("meta.examDescription", {
        title: exam.title,
        minutes: t("exam.minutes", { n: digits(exam.duration_minutes, lang) }),
        questions: t("exam.questions", { n: digits(exam.total_questions, lang) }),
      }),
    alternates: alternates(lang, `/exams/${exam.slug}`),
    openGraph: { title: exam.title, type: "article" },
  };
}

/** One exam: what it is, its rules (time, marks, negative marking, pass marks, language),
 * its schedule and instructions — then the way to take it, in the app. No questions or
 * answers are ever on the website (the public API has none). */
export default async function ExamPage({ params }: Props) {
  const { lang: raw, slug } = await params;
  const lang = raw as Lang;
  const t = translator(lang);
  const [fetched, settings, merit] = await Promise.all([
    load(slug, lang),
    getSettings(lang),
    SLUG.test(slug) ? publicGet<LeaderboardRow[]>(`exams/${slug}/leaderboard/`, lang) : null, // null = no public merit list
  ]);
  if (fetched.state === "missing") notFound();

  const back = (
    <Link href={pageHref(lang, {})} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
      <ChevronLeft className="size-4" aria-hidden />
      {t("nav.exams")}
    </Link>
  );
  if (fetched.state === "unavailable") {
    return (
      <>
        <PageIntro title={t("exams.title")}>{back}</PageIntro>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <UnavailableNote text={t("examDetail.unavailable")} />
        </div>
      </>
    );
  }

  const exam = fetched.data;
  const state = scheduleState(exam, Date.now());
  const negative = Number(exam.negative_marks) > 0;
  const app = {
    downloadUrl: settings?.app_download_url ?? "",
    openUrl: settings?.app_open_url ?? "",
    labels: { download: t("app.download"), open: t("app.open"), soon: t("app.soon") },
    lang,
  };
  const facts = [
    { icon: Clock3, label: t("examDetail.duration"), value: t("exam.minutes", { n: digits(exam.duration_minutes, lang) }) },
    { icon: FileQuestion, label: t("examDetail.questions"), value: digits(exam.total_questions, lang) },
    { icon: Trophy, label: t("examDetail.totalMarks"), value: decimal(exam.total_marks, lang) },
    { icon: MinusCircle, label: t("examDetail.negative"), value: negative ? t("examDetail.negativeValue", { n: decimal(exam.negative_marks, lang) }) : t("examDetail.none") },
    ...(exam.pass_marks ? [{ icon: Target, label: t("examDetail.passMarks"), value: decimal(exam.pass_marks, lang) }] : []),
    { icon: Languages, label: t("examDetail.language"), value: t(`examDetail.languages.${exam.content_language}`) },
  ];

  return (
    <>
      <PageIntro title={exam.title}>
        {back}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Chip tone={state === "open" ? "success" : state === "upcoming" ? "info" : "neutral"}>{t(`exams.tabs.${state}`)}</Chip>
          <Chip tone={exam.exam_type === "live" ? "danger" : "info"}>{t(`exam.type.${exam.exam_type}`)}</Chip>
          <Chip tone={exam.access_type === "free" ? "success" : "neutral"}>{t(`exam.access.${exam.access_type}`)}</Chip>
        </div>
      </PageIntro>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-8">
          <p className="text-ink-muted">
            {[exam.category.name, exam.subject?.name].filter(Boolean).join(" · ")}
            {exam.description ? <span className="mt-3 block whitespace-pre-line text-ink">{exam.description}</span> : null}
          </p>

          <section aria-labelledby="facts">
            <h2 id="facts" className="text-lg font-semibold text-ink">
              {t("examDetail.facts")}
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-card border border-line bg-surface p-4">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle">
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </dt>
                  <dd className="mt-1 font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="schedule">
            <h2 id="schedule" className="text-lg font-semibold text-ink">
              {t("examDetail.schedule")}
            </h2>
            <div className="mt-4 flex items-start gap-3 rounded-card border border-line bg-surface p-4">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
              {exam.start_at || exam.end_at ? (
                <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  {exam.start_at ? (
                    <>
                      <dt className="text-ink-subtle">{t("examDetail.starts")}</dt>
                      <dd className="font-medium text-ink">
                        <time dateTime={exam.start_at}>{dateTime(exam.start_at, lang)}</time>
                      </dd>
                    </>
                  ) : null}
                  {exam.end_at ? (
                    <>
                      <dt className="text-ink-subtle">{t("examDetail.ends")}</dt>
                      <dd className="font-medium text-ink">
                        <time dateTime={exam.end_at}>{dateTime(exam.end_at, lang)}</time>
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm font-medium text-ink">{t("examDetail.anytime")}</p>
              )}
            </div>
          </section>

          {exam.instructions ? (
            <section aria-labelledby="instructions">
              <h2 id="instructions" className="text-lg font-semibold text-ink">
                {t("examDetail.instructions")}
              </h2>
              <p className="mt-4 whitespace-pre-line rounded-card border border-line bg-surface p-5 text-sm leading-relaxed text-ink">{exam.instructions}</p>
            </section>
          ) : null}
        </div>

        <aside aria-labelledby="take" className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-4 rounded-card border border-brand-100 bg-brand-50 p-6">
            <h2 id="take" className="text-lg font-bold text-brand-950">
              {state === "ended" ? t("examDetail.endedTitle") : t("examDetail.takeTitle")}
            </h2>
            <p className="text-sm text-ink-muted">
              {state === "ended"
                ? t("examDetail.endedBody")
                : state === "upcoming" && exam.start_at
                  ? t("examDetail.upcomingBody", { date: dateTime(exam.start_at, lang) })
                  : t("examDetail.takeBody")}
            </p>
            {exam.access_type === "paid" && state !== "ended" ? (
              <p className="text-sm text-ink">
                {t("examDetail.paid")}{" "}
                <Link href={`/${lang}/packages`} className="font-semibold text-brand-700 underline">
                  {t("examDetail.seePackages")}
                </Link>
              </p>
            ) : null}
            <AppButton {...app} size="lg" className="w-full justify-center" />
          </div>
          {merit?.length ? (
            <Link
              href={`/${lang}/exams/${exam.slug}/leaderboard`}
              className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 font-semibold text-brand-700 hover:border-brand-600"
            >
              <Trophy className="size-5" aria-hidden />
              {t("examDetail.merit")}
            </Link>
          ) : null}
        </aside>
      </div>
    </>
  );
}
