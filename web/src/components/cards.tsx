import { CalendarClock, Clock3, FileQuestion, Star } from "lucide-react";

import type { Exam, Notice, Package } from "@/lib/api";
import { date, dateTime, digits, money } from "@/lib/format";
import { translator, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" | "success" | "danger" | "info" | "accent" }) {
  const tones = {
    neutral: "bg-neutral-50 text-neutral-700 border-line",
    brand: "bg-brand-50 text-brand-700 border-brand-100",
    success: "bg-success-50 text-success-700 border-success-700/20",
    danger: "bg-danger-50 text-danger-700 border-danger-700/20",
    info: "bg-info-50 text-info-700 border-info-700/20",
    accent: "bg-accent-50 text-warning-700 border-accent-500/30",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

/** An exam as visitors see it: type, free/paid, title, category, time, questions and
 * its schedule (Bangladesh time). Taking it happens in the app. */
export function ExamCard({ exam, lang }: { exam: Exam; lang: Lang }) {
  const t = translator(lang);
  return (
    <article className="flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone={exam.exam_type === "live" ? "danger" : "info"}>{t(`exam.type.${exam.exam_type}`)}</Chip>
        <Chip tone={exam.access_type === "free" ? "success" : "neutral"}>{t(`exam.access.${exam.access_type}`)}</Chip>
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">{exam.title}</h3>
        <p className="text-sm text-ink-subtle">{[exam.category.name, exam.subject?.name].filter(Boolean).join(" · ")}</p>
      </div>
      <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
        <li className="flex items-center gap-1.5">
          <Clock3 className="size-4 text-ink-subtle" aria-hidden />
          {t("exam.minutes", { n: digits(exam.duration_minutes, lang) })}
        </li>
        <li className="flex items-center gap-1.5">
          <FileQuestion className="size-4 text-ink-subtle" aria-hidden />
          {t("exam.questions", { n: digits(exam.total_questions, lang) })}
        </li>
        {exam.start_at ? (
          <li className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-ink-subtle" aria-hidden />
            {new Date(exam.start_at) > new Date() ? t("exam.starts", { date: dateTime(exam.start_at, lang) }) : exam.end_at ? t("exam.ends", { date: dateTime(exam.end_at, lang) }) : null}
          </li>
        ) : null}
      </ul>
    </article>
  );
}

export function PackageCard({ pkg, lang }: { pkg: Package; lang: Lang }) {
  const t = translator(lang);
  const days = t("package.days", { n: digits(pkg.validity_days, lang) });
  return (
    <article className={cn("flex h-full flex-col gap-4 rounded-card border bg-surface p-6 shadow-sm", pkg.is_featured ? "border-2 border-brand-600" : "border-line")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold text-ink">{pkg.name}</h3>
        {pkg.is_featured ? (
          <Chip tone="brand">
            <Star className="size-3" aria-hidden />
            {t("package.popular")}
          </Chip>
        ) : null}
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold text-brand-800">{money(pkg.price, pkg.currency, lang)}</span>
        <span className="text-ink-muted">{t("package.per", { days })}</span>
      </p>
      {pkg.description ? <p className="text-sm text-ink-muted">{pkg.description}</p> : null}
      {pkg.features.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {pkg.features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden className="text-success-700">✓</span>
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function NoticeItem({ notice, lang }: { notice: Notice; lang: Lang }) {
  const t = translator(lang);
  return (
    <article className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        {notice.is_pinned ? <Chip tone="accent">{t("pinned")}</Chip> : null}
        <time dateTime={notice.published_at} className="text-xs text-ink-subtle">
          {date(notice.published_at, lang)}
        </time>
      </div>
      <h3 className="mt-2 font-semibold text-ink">{notice.title}</h3>
      <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-ink-muted">{notice.body}</p>
    </article>
  );
}

export function SectionHead({ id, title, body }: { id?: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {title}
      </h2>
      {body ? <p className="mt-2 text-ink-muted">{body}</p> : null}
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-ink-muted">{text}</p>;
}
