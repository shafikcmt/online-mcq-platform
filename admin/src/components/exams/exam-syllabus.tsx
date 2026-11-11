"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormSection, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import {
  SYLLABUS_MAX_LENGTH,
  SYLLABUS_MAX_LINES,
  blankLine,
  fromServer,
  moveLine,
  sameSyllabus,
  toPayload,
  type SyllabusLine,
} from "@/lib/syllabus";
import type { SyllabusLineData, SyllabusResponse } from "@/types/syllabus";

/** The exam's syllabus: one line per subject / chapter / topic, in order. It is saved on its
 * own (the whole list at once) and, unlike the questions, stays editable on a published exam:
 * it never changes what is asked or how it is scored. */
export function ExamSyllabus({ examId, initial }: { examId: number; initial: SyllabusLineData[] }) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [saved, setSaved] = useState<SyllabusLineData[]>(initial);
  const [lines, setLines] = useState<SyllabusLine[]>(() => fromServer(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const dirty = !sameSyllabus(lines, saved);

  function edit(index: number, field: keyof SyllabusLineData, value: string) {
    setLines((rows) => rows.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const answer = await apiFetch<SyllabusResponse>(`/admin/exams/${examId}/syllabus/`, { method: "PUT", body: { syllabus: toPayload(lines) } });
      setSaved(answer.syllabus);
      setLines(fromServer(answer.syllabus));
      notify(t("syl.saved"));
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSection title={t("syl.title")} description={t("syl.description")}>
      {
        <div className="space-y-4">
          {lines.length === 0 ? (
            <EmptyState title={t("syl.empty")} description={t("syl.emptyHint")} />
          ) : (
            <ol className="space-y-3" aria-label={t("syl.title")}>
              {lines.map((line, index) => (
                <li key={line.key} className="rounded-card border border-line bg-surface p-3">
                  <div className="grid gap-3 md:grid-cols-[2rem_1fr_1fr_1fr_auto] md:items-end">
                    <span className="text-sm font-semibold text-ink-subtle tabular-nums md:pb-2">{index + 1}</span>
                    {(["subject", "chapter", "topic"] as const).map((field) => (
                      <label key={field} className="block text-xs font-medium text-ink-muted">
                        {t(`syl.${field}`)}
                        <Input
                          className="mt-1"
                          value={line[field]}
                          maxLength={SYLLABUS_MAX_LENGTH}
                          aria-label={`${t("syl.line", { n: String(index + 1) })}: ${t(`syl.${field}`)}`}
                          onChange={(event) => edit(index, field, event.target.value)}
                          disabled={busy}
                        />
                      </label>
                    ))}
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("syl.moveUp", { n: String(index + 1) })}
                        disabled={busy || index === 0}
                        onClick={() => {
                          setLines(moveLine(lines, index, -1));
                          setAnnouncement(t("syl.moved", { n: String(index) }));
                        }}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("syl.moveDown", { n: String(index + 1) })}
                        disabled={busy || index === lines.length - 1}
                        onClick={() => {
                          setLines(moveLine(lines, index, 1));
                          setAnnouncement(t("syl.moved", { n: String(index + 2) }));
                        }}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("syl.remove", { n: String(index + 1) })}
                        disabled={busy}
                        onClick={() => {
                          setLines(lines.filter((_, position) => position !== index));
                          setAnnouncement(t("syl.removed"));
                        }}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {error && (
            <Alert tone="danger" live>
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setLines([...lines, blankLine()])} disabled={busy || lines.length >= SYLLABUS_MAX_LINES}>
              <Plus aria-hidden />
              {t("syl.add")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || !dirty} aria-busy={busy || undefined}>
              {busy ? t("syl.saving") : t("syl.save")}
            </Button>
            {dirty && <span className="text-sm text-warning-700">{t("syl.unsaved")}</span>}
          </div>
          <p className="text-xs text-ink-subtle">{t("syl.blankNote")}</p>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      }
    </FormSection>
  );
}
