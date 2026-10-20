import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { fieldId, isValidationError, mapFieldErrors } from "@/lib/api/field-errors";
import { isQuestionField } from "@/lib/question-form";

describe("mapFieldErrors", () => {
  it("maps plain and nested (per-option) errors to dotted keys", () => {
    const error = new ApiError(400, "validation_error", "Please correct the highlighted fields.", {
      text_en: ["Too long."],
      options: [{}, { text_bn: ["Option 2 needs Bangla."] }, {}] as unknown as string[],
    });
    expect(mapFieldErrors(error, isQuestionField)).toEqual({
      fields: { text_en: "Too long.", "options.1.text_bn": "Option 2 needs Bangla." },
      form: [],
    });
  });

  it("keeps option-set messages on `options` and sends unknown fields to the form level", () => {
    const error = new ApiError(400, "validation_error", "x", {
      options: ["Mark exactly one option as correct."],
      non_field_errors: ["Something general."],
      created_by: ["Not editable."],
    });
    expect(mapFieldErrors(error, isQuestionField)).toEqual({
      fields: { options: "Mark exactly one option as correct." },
      form: ["Something general.", "Not editable."],
    });
  });

  it("ignores anything that is not an API validation error", () => {
    expect(mapFieldErrors(new Error("boom"), () => true)).toEqual({ fields: {}, form: [] });
    expect(isValidationError(new ApiError(409, "in_use", "x"))).toBe(false);
    expect(isValidationError(new ApiError(400, "validation_error", "x", { slug: ["Taken"] }))).toBe(true);
    expect(fieldId("options.2.text_en")).toBe("field-options-2-text_en");
  });
});
