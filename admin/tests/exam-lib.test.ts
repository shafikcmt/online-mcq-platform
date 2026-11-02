import { describe, expect, it } from "vitest";

import { publishProblems, questionSaveErrors } from "@/components/exams/exam-editor";
import { ApiError } from "@/lib/api/errors";
import { describeExamError } from "@/lib/exam-errors";
import {
  attemptRules,
  draftFromExam,
  fromDhakaInput,
  newExamDraft,
  sameDraft,
  toDhakaInput,
  toExamPayload,
  withPracticeDefaults,
} from "@/lib/exam-form";
import {
  addQuestion,
  fromBankQuestion,
  fromRows,
  moveQuestion,
  questionIdsInMessages,
  removeQuestion,
  sameAssignment,
  setMarks,
  toQuestionsPayload,
  totalMarks,
} from "@/lib/exam-questions";
import { MESSAGES, translate } from "@/lib/i18n/messages";

import { exam, examRow, question } from "./content-helpers";

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(MESSAGES.en, key, vars);

describe("schedule in Asia/Dhaka", () => {
  it("shows API times in Dhaka wall time and sends them with +06:00", () => {
    expect(toDhakaInput("2030-01-15T03:30:00Z")).toBe("2030-01-15T09:30");
    expect(toDhakaInput("2030-01-14T20:00:00Z")).toBe("2030-01-15T02:00"); // crosses midnight
    expect(toDhakaInput(null)).toBe("");
    expect(fromDhakaInput("2030-01-15T09:30")).toBe("2030-01-15T09:30:00+06:00");
    expect(fromDhakaInput("")).toBeNull();
    expect(fromDhakaInput("nonsense")).toBe("nonsense"); // the server reports it on the field
    expect(fromDhakaInput(toDhakaInput("2030-01-15T03:30:00Z"))).toBe("2030-01-15T09:30:00+06:00");
  });
});

describe("toExamPayload", () => {
  it("sends every setting with real API types", () => {
    const draft = { ...newExamDraft("1"), title_en: "T", duration_minutes: "30", total_questions: "5", subject: "" };
    expect(toExamPayload(draft)).toMatchObject({
      category: 1,
      subject: null,
      duration_minutes: 30,
      total_questions: 5,
      pass_marks: null,
      start_at: null,
      default_marks: "1.00",
      negative_marks: "0.00",
      allow_retake: false,
      max_attempts: 1, // no retakes → one attempt
    });
    expect(toExamPayload(draft)).not.toHaveProperty("status"); // status changes only through actions
  });

  it("live: one attempt, no retakes, first-attempt merit (as shown in the form)", () => {
    const draft = { ...newExamDraft("1"), exam_type: "live" as const, allow_retake: true, max_attempts: "5", merit_strategy: "best_attempt" as const };
    expect(attemptRules(draft)).toMatchObject({ live: true, retakeLocked: true, singleAttempt: true });
    expect(toExamPayload(draft)).toMatchObject({ allow_retake: false, max_attempts: 1, merit_strategy: "first_attempt" });
  });

  it("retakes: empty max attempts = unlimited (null), a number is sent as typed", () => {
    const draft = { ...newExamDraft("1"), allow_retake: true, max_attempts: "" };
    expect(toExamPayload(draft).max_attempts).toBeNull();
    expect(toExamPayload({ ...draft, max_attempts: "3" }).max_attempts).toBe(3);
    expect(toExamPayload({ ...draft, max_attempts: "1" }).max_attempts).toBe(1); // server explains the rule
  });

  it("omits cleared required decimals instead of sending an invalid empty string", () => {
    const payload = toExamPayload({ ...newExamDraft("1"), default_marks: " ", negative_marks: "" });
    expect(payload).not.toHaveProperty("default_marks");
    expect(payload).not.toHaveProperty("negative_marks");
  });

  it("practice defaults are shown (and so sent) only when chosen", () => {
    expect(withPracticeDefaults(newExamDraft())).toMatchObject({ allow_retake: true, max_attempts: "", merit_enabled: false });
  });

  it("round-trips an exam without changes", () => {
    const source = exam({ start_at: "2030-01-15T03:30:00Z", end_at: "2030-01-15T06:00:00Z", pass_marks: "1.50" });
    const draft = draftFromExam(source);
    expect(sameDraft(draft, draftFromExam(source))).toBe(true);
    expect(toExamPayload(draft)).toMatchObject({ start_at: "2030-01-15T09:30:00+06:00", end_at: "2030-01-15T12:00:00+06:00", pass_marks: "1.50" });
  });
});

describe("assigned question list", () => {
  const items = fromRows([examRow(3, 2), examRow(1, 0, { marks: "2.00" }), examRow(2, 1)]);

  it("loads rows in sort_order", () => {
    expect(items.map((item) => item.question)).toEqual([1, 2, 3]);
    expect(items[0].marks).toBe("2.00");
  });

  it("never adds a question twice", () => {
    const once = addQuestion(items, fromBankQuestion(question({ id: 9 })));
    expect(addQuestion(once, fromBankQuestion(question({ id: 9 })))).toBe(once);
    expect(addQuestion(items, fromBankQuestion(question({ id: 2 })))).toBe(items);
    expect(once.map((item) => item.question)).toEqual([1, 2, 3, 9]);
  });

  it("moves within bounds and removes", () => {
    expect(moveQuestion(items, 0, -1)).toBe(items);
    expect(moveQuestion(items, 2, 1)).toBe(items);
    expect(moveQuestion(items, 2, -1).map((item) => item.question)).toEqual([1, 3, 2]);
    expect(removeQuestion(items, 2).map((item) => item.question)).toEqual([1, 3]);
  });

  it("builds the COMPLETE payload: positions 0…n-1, override or null", () => {
    const edited = setMarks(moveQuestion(addQuestion(items, fromBankQuestion(question({ id: 9 }))), 3, -1), 3, " 0.5 ");
    expect(toQuestionsPayload(edited)).toEqual({
      questions: [
        { question: 1, sort_order: 0, marks: "2.00" },
        { question: 2, sort_order: 1, marks: null },
        { question: 9, sort_order: 2, marks: null },
        { question: 3, sort_order: 3, marks: "0.5" },
      ],
    });
    expect(toQuestionsPayload([])).toEqual({ questions: [] }); // clearing is an explicit empty list
  });

  it("detects changes for the unsaved guard and totals marks", () => {
    expect(sameAssignment(items, fromRows([examRow(1, 0, { marks: "2.00" }), examRow(2, 1), examRow(3, 2)]))).toBe(true);
    expect(sameAssignment(items, moveQuestion(items, 0, 1))).toBe(false);
    expect(sameAssignment(items, setMarks(items, 2, "3"))).toBe(false);
    expect(totalMarks(items, "1.00")).toBe(4);
    expect(totalMarks(setMarks(items, 2, "x"), "1.00")).toBeNull();
  });

  it("finds question ids in server messages", () => {
    expect([...questionIdsInMessages(["Question #12 is inactive.", "Question #7 is not available in English.", "x"])]).toEqual([12, 7]);
  });
});

describe("server errors", () => {
  it("publish errors: summary entries ordered by section", () => {
    const error = new ApiError(400, "validation_error", "x", {
      questions: ["This exam needs 3 questions but 2 are assigned.", "Question #12 is inactive."],
      title_en: ["A title in English is required for this exam's language."],
      start_at: ["Live exams need a start and an end time."],
    });
    expect(publishProblems(error)).toEqual([
      { field: "title_en", section: "basics", messages: ["A title in English is required for this exam's language."] },
      { field: "start_at", section: "schedule", messages: ["Live exams need a start and an end time."] },
      { field: "questions", section: "questions", messages: ["This exam needs 3 questions but 2 are assigned.", "Question #12 is inactive."] },
    ]);
  });

  it("question save errors: per-row messages go to that question (by the sent order)", () => {
    const sent = fromRows([examRow(5, 0), examRow(8, 1)]);
    const error = new ApiError(400, "validation_error", "x", {
      questions: [{}, { marks: ["Ensure this value is greater than or equal to 0.01."] }] as unknown as string[],
    });
    expect(questionSaveErrors(error, sent)).toEqual({ form: [], rows: { 8: "Ensure this value is greater than or equal to 0.01." } });
    const flat = new ApiError(400, "validation_error", "x", { questions: ["Question #99 does not exist."] });
    expect(questionSaveErrors(flat, sent)).toEqual({ form: ["Question #99 does not exist."], rows: {} });
  });

  it.each([
    ["exam_locked", "This exam can't be changed now"],
    ["already_published", "This exam is already published"],
    ["not_published", "This exam isn't published"],
    ["not_archivable", "This exam can't be archived"],
    ["invalid_status", "Not possible in the exam's current status"],
    ["exam_not_deletable", "Only draft exams can be deleted"],
    ["exam_has_attempts", "Students have already taken this exam"],
    ["in_use", "This exam is still in use"],
    ["merit_disabled", "The merit list is turned off"],
  ])("409 %s → translated title + the server's message", (code, title) => {
    const error = new ApiError(409, code, "Server says why.", {}, true);
    expect(describeExamError(error, t)).toEqual({ title, message: "Server says why." });
  });

  it("an unknown 409 still gets a generic title; 404 → not found", () => {
    expect(describeExamError(new ApiError(409, "other", "Why.", {}, true), t).title).toBe("Can't complete this action");
    expect(describeExamError(new ApiError(404, "not_found", "x"), t).message).toBe(t("error.notFound"));
  });
});
