import { FileText } from "lucide-react";
import Link from "next/link";

import type { Lang } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import type { Material } from "@/lib/materials";

import { Chip } from "./cards";
import { VideoPlayer } from "./video-player";

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** One study material: a video (play on demand) or a PDF handout (opens through the API address). */
export function MaterialCard({ material, lang }: { material: Material; lang: Lang }) {
  const t = translator(lang);
  const place = [material.category?.name, material.subject?.name].filter(Boolean).join(" · ");
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm">
      {material.kind === "video" ? (
        <VideoPlayer id={material.youtube_id} title={material.title} playLabel={t("materials.play", { title: material.title })} watchLabel={t("materials.watchOnYoutube")} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={material.kind === "video" ? "accent" : "neutral"}>{material.kind === "video" ? t("materials.videoLabel") : t("materials.pdfLabel")}</Chip>
        {place ? <span className="text-xs text-ink-subtle">{place}</span> : null}
      </div>
      <h2 className="text-lg font-semibold text-ink">{material.title}</h2>
      {material.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{material.description}</p> : null}
      {material.teacher ? <p className="text-sm text-ink-muted">{t("materials.teacher", { name: material.teacher })}</p> : null}
      {material.exam ? (
        <p className="text-sm">
          <Link href={`/${lang}/exams/${material.exam.slug}`} className="font-semibold text-brand-700 hover:underline">
            {t("materials.exam", { name: material.exam.name })}
          </Link>
        </p>
      ) : null}
      {material.kind === "pdf" && material.pdf.available ? (
        <a
          href={`/api/v1/public/materials/${material.id}/pdf/`}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-control border border-line-strong px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          <FileText className="size-4" aria-hidden />
          {t("materials.openPdf")}
          <span className="font-normal text-ink-subtle">({sizeText(material.pdf.size_bytes)})</span>
        </a>
      ) : null}
    </article>
  );
}
