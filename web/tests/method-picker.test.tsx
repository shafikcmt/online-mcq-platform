import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MethodPicker } from "@/components/method-picker";
import type { PaymentMethod } from "@/lib/account";

const method = (gateway: string, over: Partial<PaymentMethod> = {}): PaymentMethod => ({
  provider: "bkash",
  gateway,
  label: gateway,
  name: `Name ${gateway}`,
  description: "",
  logo_url: "",
  min_amount: null,
  max_amount: null,
  is_test: false,
  ...over,
});

const render = (methods: PaymentMethod[]) =>
  renderToStaticMarkup(<MethodPicker id="m1" methods={methods} legend="Pay with" testBadge="Test payment" testNote="Test mode note" />);

describe("MethodPicker", () => {
  test("no method: nothing is drawn", () => {
    expect(render([])).toBe("");
  });

  test("one method: shown as a row and still sent as the gateway field", () => {
    const html = render([method("bkash-main", { description: "Pay by bKash" })]);
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="gateway"');
    expect(html).toContain('value="bkash-main"');
    expect(html).toContain("Name bkash-main");
    expect(html).toContain("Pay by bKash");
    expect(html).not.toContain('type="radio"');
  });

  test("several methods: radio choices, the first selected", () => {
    const html = render([method("bkash-main"), method("bkash-two"), method("ssl")]);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html.indexOf("checked")).toBeLessThan(html.indexOf('value="bkash-two"'));
  });

  test("a test gateway is marked, with the note", () => {
    const html = render([method("sandbox", { is_test: true })]);
    expect(html).toContain("Test payment");
    expect(html).toContain("Test mode note");
    expect(render([method("live")])).not.toContain("Test mode note");
  });

  test("a logo is drawn only for an https address", () => {
    expect(render([method("a", { logo_url: "https://cdn.example/a.png" })])).toContain('src="https://cdn.example/a.png"');
    for (const bad of ["http://cdn.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//cdn.example/a.png"]) {
      expect(render([method("a", { logo_url: bad })]), bad).not.toContain("<img");
    }
  });
});
