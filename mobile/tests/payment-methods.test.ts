import { logoUri, methodsForPrice } from "@/features/packages/methods";
import type { PaymentMethod } from "@/features/packages/types";

const method = (gateway: string, min: string | null, max: string | null): PaymentMethod => ({
  provider: "bkash",
  gateway,
  label: gateway,
  name: gateway,
  description: "",
  logo_url: "",
  min_amount: min,
  max_amount: max,
  is_test: false,
});

const all = [method("a", null, null), method("b", "100.00", null), method("c", null, "300.00"), method("d", "100.00", "300.00")];
const names = (price: string) => methodsForPrice(all, price).map((item) => item.gateway);

test("methods whose limits the price does not fit are hidden", () => {
  expect(names("50.00")).toEqual(["a", "c"]);
  expect(names("200.00")).toEqual(["a", "b", "c", "d"]);
  expect(names("500.00")).toEqual(["a", "b"]);
});

test("the limits themselves are allowed", () => {
  expect(names("100.00")).toEqual(["a", "b", "c", "d"]);
  expect(names("300.00")).toEqual(["a", "b", "c", "d"]);
});

test("an unreadable price hides nothing (the server decides)", () => {
  expect(methodsForPrice(all, "abc")).toHaveLength(4);
});

test("a logo is drawn only for an https address", () => {
  expect(logoUri("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  for (const bad of ["", "http://cdn.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//cdn.example/a.png", "https://a b"]) {
    expect(logoUri(bad)).toBeNull();
  }
});
