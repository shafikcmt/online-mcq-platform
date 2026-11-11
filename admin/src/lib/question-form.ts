import type { Difficulty, Question } from "@/types/content";

/** Question editor state and its conversion to the API payload.
 *
 * Options are edited as one set: the payload always carries the COMPLETE list, in the
 * order shown, and on PATCH the server replaces the stored set with it (option ids change;
 * docs/API_PLAN.md). `key` is a client-only id for React lists — never sent. */
export type OptionDraft = { key: string; text_bn: string; text_en: string; is_correct: boolean };

export type QuestionDraft = {
  category: string;
  subject: string;
  text_bn: string;
  text_en: string;
  explanation_bn: string;
  explanation_en: string;
  chapter: string;
  topic: string;
  difficulty: Difficulty | "";
  is_active: boolean;
  options: OptionDraft[];
};

let counter = 0;
export function optionKey(): string {
  counter += 1;
  return `opt-${counter}`;
}

export function emptyOption(): OptionDraft {
  return { key: optionKey(), text_bn: "", text_en: "", is_correct: false };
}

/** A new question starts with four blank options and no correct answer: the admin must
 * choose it (nothing is pre-selected by accident). Four is only a starting layout; the
 * allowed number of options is a server setting. */
export const STARTING_OPTIONS = 4;

export function newDraft(category = ""): QuestionDraft {
  return {
    category,
    subject: "",
    text_bn: "",
    text_en: "",
    explanation_bn: "",
    explanation_en: "",
    chapter: "",
    topic: "",
    difficulty: "",
    is_active: true,
    options: Array.from({ length: STARTING_OPTIONS }, emptyOption),
  };
}

export function draftFromQuestion(question: Question): QuestionDraft {
  return {
    category: String(question.category),
    subject: String(question.subject),
    text_bn: question.text_bn,
    text_en: question.text_en,
    explanation_bn: question.explanation_bn,
    explanation_en: question.explanation_en,
    chapter: question.chapter ?? "",
    topic: question.topic ?? "",
    difficulty: question.difficulty,
    is_active: question.is_active,
    options: [...question.options]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((option) => ({ key: optionKey(), text_bn: option.text_bn, text_en: option.text_en, is_correct: option.is_correct })),
  };
}

export function toPayload(draft: QuestionDraft) {
  return {
    subject: draft.subject ? Number(draft.subject) : null,
    text_bn: draft.text_bn,
    text_en: draft.text_en,
    explanation_bn: draft.explanation_bn,
    explanation_en: draft.explanation_en,
    chapter: draft.chapter,
    topic: draft.topic,
    difficulty: draft.difficulty,
    is_active: draft.is_active,
    options: draft.options.map((option, index) => ({
      text_bn: option.text_bn,
      text_en: option.text_en,
      is_correct: option.is_correct,
      sort_order: index,
    })),
  };
}

export function correctCount(draft: QuestionDraft): number {
  return draft.options.filter((option) => option.is_correct).length;
}

/** Mark one option correct; every other option becomes not correct. */
export function setCorrect(options: OptionDraft[], key: string): OptionDraft[] {
  return options.map((option) => ({ ...option, is_correct: option.key === key }));
}

export function moveOption(options: OptionDraft[], index: number, delta: -1 | 1): OptionDraft[] {
  const target = index + delta;
  if (target < 0 || target >= options.length) return options;
  const next = [...options];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Field keys the editor can show errors for (`options.N.*` are per-option fields). */
export const QUESTION_FIELDS = new Set(["subject", "text_bn", "text_en", "explanation_bn", "explanation_en", "chapter", "topic", "difficulty", "is_active", "options"]);
export function isQuestionField(key: string): boolean {
  return QUESTION_FIELDS.has(key) || /^options\.\d+\.(text_bn|text_en|is_correct)$/.test(key);
}
