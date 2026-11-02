"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Exam } from "@/lib/api";
import { dateTime, digits } from "@/lib/format";
import { translator, type Lang } from "@/lib/i18n";

export type SpotlightState = "live" | "open" | "upcoming";

/** The featured exam under the hero: a live or open exam, or the next upcoming one, with a
 * countdown that ticks every second in the browser. The countdown appears after the page
 * hydrates (the server-rendered HTML shows the schedule line only, so nothing mismatches). */
export function Spotlight({ exam, state, lang }: { exam: Exam; state: SpotlightState; lang: Lang }) {
  const t = translator(lang);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const target = state === "upcoming" ? exam.start_at : exam.end_at;
  const total = target && now !== null ? Math.max(0, Math.floor((Date.parse(target) - now) / 1000)) : null;
  const parts =
    total === null
      ? null
      : total >= 86_400
        ? [
            [Math.floor(total / 86_400), t("home.spotlight.units.days")],
            [Math.floor((total % 86_400) / 3_600), t("home.spotlight.units.hours")],
            [Math.floor((total % 3_600) / 60), t("home.spotlight.units.minutes")],
          ]
        : [
            [Math.floor(total / 3_600), t("home.spotlight.units.hours")],
            [Math.floor((total % 3_600) / 60), t("home.spotlight.units.minutes")],
            [total % 60, t("home.spotlight.units.seconds")],
          ];
  const when =
    state === "upcoming" && exam.start_at
      ? t("home.spotlight.startsAt", { time: dateTime(exam.start_at, lang) })
      : exam.end_at
        ? t("home.spotlight.endsAt", { time: dateTime(exam.end_at, lang) })
        : t("home.spotlight.duration", { n: digits(exam.duration_minutes, lang) });
  const badge = {
    live: "bg-[#E5383B] text-white",
    open: "bg-success-700 text-white",
    upcoming: "bg-white/15 text-white",
  }[state];

  return (
    <div className="relative overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-[#0A1E5E] to-[#1250E4] p-6 text-white shadow-float sm:p-8">
      <div aria-hidden className="absolute -right-10 -top-12 size-48 rounded-full bg-white/[0.06]" />
      <div aria-hidden className="absolute -bottom-10 right-24 size-32 rounded-full bg-white/[0.05]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${badge}`}>
              {state !== "upcoming" ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white" /> : null}
              {t(`home.spotlight.state.${state}`)}
            </span>
            <span className="text-xs text-brand-100">{exam.category.name}</span>
            {exam.access_type === "free" ? <span className="text-xs font-semibold text-accent-500">{t("home.spotlight.free")}</span> : null}
          </div>
          <h2 className="text-2xl font-bold sm:text-3xl">{exam.title}</h2>
          <p className="text-sm text-brand-100">
            {when} · {t("home.spotlight.questions", { n: digits(exam.total_questions, lang) })}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {parts ? (
            <div className="grid grid-cols-3 gap-2" role="timer" aria-label={`${t(state === "upcoming" ? "home.spotlight.startsIn" : "home.spotlight.endsIn")} ${parts.map(([v, l]) => `${digits(v, lang)} ${l}`).join(" ")}`}>
              {parts.map(([value, label]) => (
                <div key={String(label)} className="rounded-card bg-white/10 py-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{digits(String(value).padStart(2, "0"), lang)}</div>
                  <div className="text-xs text-brand-100">{label}</div>
                </div>
              ))}
            </div>
          ) : null}
          <Link
            href={`/${lang}/exams/${exam.slug}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-accent-500 px-5 font-bold text-brand-950 transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {state === "upcoming" ? t("home.spotlight.details") : t("home.spotlight.join")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
