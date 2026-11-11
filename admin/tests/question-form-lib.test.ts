import { describe, expect, it } from "vitest";

import { correctCount, draftFromQuestion, moveOption, newDraft, setCorrect, toPayload } from "@/lib/question-form";

import { question } from "./content-helpers";

describe("question editor state", () => {
  it("starts a new question with blank options and no correct answer chosen", () => {
    const draft = newDraft("3");
    expect(draft.category).toBe("3");
    expect(draft.options).toHaveLength(4);
    expect(correctCount(draft)).toBe(0);
  });

  it("loads options in sort order and sends the COMPLETE set, renumbered, without ids", () => {
    const source = question({
      options: [
        { id: 9, text_bn: "গ", text_en: "C", is_correct: false, sort_order: 5 },
        { id: 7, text_bn: "ক", text_en: "A", is_correct: true, sort_order: 1 },
      ],
    });
    const draft = draftFromQuestion(source);
    expect(draft.options.map((option) => option.text_en)).toEqual(["A", "C"]);
    const payload = toPayload({ ...draft, options: moveOption(draft.options, 0, 1) });
    expect(payload.subject).toBe(10);
    expect(payload.options).toEqual([
      { text_bn: "গ", text_en: "C", is_correct: false, sort_order: 0 },
      { text_bn: "ক", text_en: "A", is_correct: true, sort_order: 1 },
    ]);
  });

  it("carries the chapter and topic (empty for a new question, kept when editing)", () => {
    expect(newDraft().chapter).toBe("");
    const draft = draftFromQuestion(question({ chapter: "Optics", topic: "Light" }));
    expect([draft.chapter, draft.topic]).toEqual(["Optics", "Light"]);
    const payload = toPayload({ ...draft, topic: "Speed of light" });
    expect([payload.chapter, payload.topic]).toEqual(["Optics", "Speed of light"]);
  });

  it("allows only one correct option", () => {
    const draft = draftFromQuestion(question());
    const options = setCorrect(draft.options, draft.options[2].key);
    expect(options.map((option) => option.is_correct)).toEqual([false, false, true]);
    expect(moveOption(options, 0, -1)).toBe(options); // out of range: unchanged
  });
});
