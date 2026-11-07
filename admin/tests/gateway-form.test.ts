import { describe, expect, it } from "vitest";

import { coerceOption, issueText, settingsChanges, settingsDraft, testMessage, typedCredentials } from "@/lib/gateway-form";
import { en, translate } from "@/lib/i18n/messages";

import { bkashAdapter, gateway } from "./gateway-fixtures";

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(en, key, vars);

describe("settings draft and changes", () => {
  it("an untouched form changes nothing", () => {
    const g = gateway();
    expect(settingsChanges(g, settingsDraft(g, bkashAdapter), bkashAdapter)).toEqual({});
  });

  it("sends only what changed, with numbers as numbers and an emptied limit as null", () => {
    const g = gateway({ min_amount: "10.00" });
    const draft = settingsDraft(g, bkashAdapter);
    draft.name_en = "  bKash Personal ";
    draft.priority = "3";
    draft.min_amount = "";
    draft.app_enabled = false;
    draft.options.timeout_seconds = "20";
    expect(settingsChanges(g, draft, bkashAdapter)).toEqual({
      name_en: "bKash Personal",
      priority: 3,
      min_amount: null,
      app_enabled: false,
      options: { api_version: "v1.2.0-beta", timeout_seconds: 20 },
    });
  });

  it("a non-numeric priority or option is left for the server to refuse", () => {
    const g = gateway();
    const draft = settingsDraft(g, bkashAdapter);
    draft.priority = "high";
    draft.options.timeout_seconds = "soon";
    const body = settingsChanges(g, draft, bkashAdapter);
    expect(body.priority).toBe("high");
    expect(body.options).toMatchObject({ timeout_seconds: "soon" });
  });

  it("coerces option kinds", () => {
    const [, integer] = bkashAdapter.options;
    expect(coerceOption(integer, " 30 ")).toBe(30);
    expect(coerceOption({ ...integer, kind: "boolean" }, true)).toBe(true);
    expect(coerceOption({ ...integer, kind: "text" }, " x ")).toBe("x");
  });
});

describe("secrets", () => {
  it("only typed values are sent; blank ones keep the stored secret", () => {
    expect(typedCredentials({ app_key: "  new-key ", app_secret: "", username: "   " })).toEqual({ app_key: "new-key" });
  });
});

describe("server codes become text", () => {
  it("names the missing credential from the schema, in the panel language", () => {
    expect(issueText("missing_credential:app_key", bkashAdapter, "en", t)).toBe("Missing credential: app key");
    expect(issueText("missing_credential:nope", bkashAdapter, "en", t)).toBe("Missing credential: nope");
  });
  it("known and unknown issue codes", () => {
    expect(issueText("no_successful_sandbox_payment", bkashAdapter, "en", t)).toMatch(/sandbox payment/);
    expect(issueText("something_new", bkashAdapter, "en", t)).toBe("Not ready.");
  });
  it("connection test messages", () => {
    expect(testMessage("token_granted", bkashAdapter, "en", t)).toMatch(/accepted/);
    expect(testMessage("missing_credential:app_key", bkashAdapter, "en", t)).toMatch(/Missing credential/);
    expect(testMessage("weird", bkashAdapter, "en", t)).toBe("Provider answer: weird");
    expect(testMessage("", bkashAdapter, "en", t)).toBe("");
  });
});
