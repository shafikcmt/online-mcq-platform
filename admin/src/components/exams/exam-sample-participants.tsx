"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormSection, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { describeError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { Paginated } from "@/types/content";
import { SAMPLE_MAX_PER_EXAM, type SampleEntriesResponse, type SamplePerson } from "@/types/sample";

type Line = { key: number; person: string; marks: string };
let nextKey = 1;
const line = (person = "", marks = ""): Line => ({ key: nextKey++, person, marks });
const fromServer = (data: SampleEntriesResponse): Line[] => data.entries.map((entry) => line(String(entry.person), entry.marks));
const signature = (lines: Line[]) => JSON.stringify(lines.map((row) => [row.person, row.marks.trim()]));

/** Sample participants of one exam: pick people from the library and give each marks. Saved on its own
 * (the whole list at once); allowed on a published exam because it changes no question, scoring or real
 * result. Students always see these as "sample participants", apart from real students. */
export function ExamSampleParticipants({ examId }: { examId: number }) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
  const [people, setPeople] = useState<SamplePerson[]>([]);
  const [total, setTotal] = useState("0");
  const [saved, setSaved] = useState("[]");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch<SampleEntriesResponse>(`/admin/exams/${examId}/sample-participants/`),
      apiFetch<Paginated<SamplePerson>>("/admin/sample-participants/?page_size=100&ordering=name"),
    ])
      .then(([entries, library]) => {
        if (!alive) return;
        const initial = fromServer(entries);
        // The library, plus anyone already in the exam who is no longer listed (for example inactive).
        const known = new Set(library.results.map((person) => person.id));
        const extra = entries.entries.filter((entry) => !known.has(entry.person)).map((entry) => ({ id: entry.person, name: entry.name, is_active: entry.is_active, exam_count: 0, created_at: "", updated_at: "" }));
        setPeople([...library.results, ...extra]);
        setTotal(entries.total_marks);
        setLines(initial);
        setSaved(signature(initial));
        setState("ready");
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
    };
  }, [examId]);

  const dirty = signature(lines) !== saved;
  const taken = new Set(lines.map((row) => row.person).filter(Boolean));

  function edit(key: number, patch: Partial<Line>) {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (busy) return;
    if (lines.some((row) => !row.person)) return setError(t("sp.exam.pickPerson"));
    const max = Number(total);
    for (const row of lines) {
      const marks = Number(row.marks);
      if (row.marks.trim() === "" || !Number.isFinite(marks) || marks < 0 || marks > max) return setError(t("sp.exam.marksInvalid", { total }));
    }
    setBusy(true);
    setError("");
    try {
      const answer = await apiFetch<SampleEntriesResponse>(`/admin/exams/${examId}/sample-participants/`, {
        method: "PUT",
        body: { entries: lines.map((row) => ({ person: Number(row.person), marks: row.marks.trim() })) },
      });
      const next = fromServer(answer);
      setLines(next);
      setSaved(signature(next));
      notify(t("sp.exam.saved"));
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSection title={t("sp.exam.title")} description={t("sp.exam.description")}>
      {state === "loading" ? (
        <p className="text-sm text-ink-muted" role="status">
          {t("common.loading")}
        </p>
      ) : state === "failed" ? (
        <Alert tone="danger">{t("sp.exam.loadFailed")}</Alert>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">{t("sp.exam.total", { n: total })}</p>
          {lines.length === 0 ? (
            <EmptyState title={t("sp.exam.empty")} description={people.length ? t("sp.exam.emptyHint") : t("sp.exam.none")} />
          ) : (
            <ol className="space-y-3" aria-label={t("sp.exam.title")}>
              {lines.map((row, index) => {
                const chosen = people.find((person) => String(person.id) === row.person);
                return (
                  <li key={row.key} className="rounded-card border border-line bg-surface p-3">
                    <div className="grid gap-3 md:grid-cols-[2rem_1fr_10rem_auto] md:items-end">
                      <span className="text-sm font-semibold text-ink-subtle tabular-nums md:pb-2">{index + 1}</span>
                      <label className="block text-xs font-medium text-ink-muted">
                        {t("sp.exam.person")}
                        <Select className="mt-1" value={row.person} onChange={(event) => edit(row.key, { person: event.target.value })} disabled={busy} aria-label={`${t("sp.exam.person")} ${index + 1}`}>
                          <option value="">{t("sp.exam.choose")}</option>
                          {people.map((person) => (
                            <option key={person.id} value={person.id} disabled={taken.has(String(person.id)) && String(person.id) !== row.person}>
                              {person.name}
                              {person.is_active ? "" : ` ${t("sp.exam.inactive")}`}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="block text-xs font-medium text-ink-muted">
                        {t("sp.exam.marks")}
                        <Input className="mt-1" type="number" inputMode="decimal" min={0} max={Number(total)} step="0.01" value={row.marks} onChange={(event) => edit(row.key, { marks: event.target.value })} disabled={busy} aria-label={`${t("sp.exam.marks")} ${index + 1}`} />
                      </label>
                      <Button variant="ghost" size="icon" aria-label={t("sp.exam.remove", { n: String(index + 1) })} disabled={busy} onClick={() => setLines(lines.filter((candidate) => candidate.key !== row.key))}>
                        <X aria-hidden />
                      </Button>
                    </div>
                    {chosen && !chosen.is_active ? <p className="mt-2 text-xs text-warning-700">{t("sp.exam.inactive")}</p> : null}
                  </li>
                );
              })}
            </ol>
          )}
          {error && (
            <Alert tone="danger" live>
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setLines([...lines, line()])} disabled={busy || lines.length >= SAMPLE_MAX_PER_EXAM || people.length === 0}>
              <Plus aria-hidden />
              {t("sp.exam.add")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || !dirty} aria-busy={busy || undefined}>
              {busy ? t("sp.exam.saving") : t("sp.exam.save")}
            </Button>
            <Link href="/sample-participants" className={buttonVariants({ variant: "ghost" })}>
              {t("sp.exam.manage")}
            </Link>
            {dirty && <span className="text-sm text-warning-700">{t("sp.exam.unsaved")}</span>}
          </div>
        </div>
      )}
    </FormSection>
  );
}
