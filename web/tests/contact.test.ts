import { describe, expect, test } from "vitest";

import { serverFieldErrors, validateContact, type ContactFields } from "@/lib/contact";

const filled: ContactFields = { name: "Rahim", phone: "01712345678", email: "", subject: "App", message: "Hello", website: "" };

describe("contact form checks", () => {
  test("a complete form passes; a phone or an email is enough", () => {
    expect(validateContact(filled)).toEqual({});
    expect(validateContact({ ...filled, phone: "", email: "rahim@example.com" })).toEqual({});
  });

  test("name, subject and message are required (spaces do not count)", () => {
    expect(validateContact({ ...filled, name: "  ", subject: "", message: "\n" })).toEqual({ name: "required", subject: "required", message: "required" });
  });

  test("neither phone nor email → both fields say so; a bad email is caught", () => {
    expect(validateContact({ ...filled, phone: "" })).toEqual({ phone: "needContact", email: "needContact" });
    expect(validateContact({ ...filled, email: "not-an-email" })).toEqual({ email: "invalidEmail" });
  });

  test("the backend's field errors map to our fields; anything else is ignored", () => {
    const body = { error: { code: "validation_error", message: "…", field_errors: { phone: ["Enter a valid phone number."], website: ["x"], non_field_errors: ["y"] } } };
    expect(serverFieldErrors(body)).toEqual({ phone: "Enter a valid phone number." });
    expect(serverFieldErrors(null)).toEqual({});
    expect(serverFieldErrors({ error: { field_errors: { email: "Bad." } } })).toEqual({ email: "Bad." });
  });
});
