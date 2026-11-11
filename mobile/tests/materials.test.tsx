import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";

import type { Material } from "@/features/materials/types";
import { youtubeWatchUrl } from "@/features/materials/api";

import { mockBackend, renderApp, resetDevice, STUDENT } from "./helpers";

jest.setTimeout(20_000);

const ID = "dQw4w9WgXcQ";
const item = (over: Partial<Material> = {}): Material => ({
  id: 1,
  kind: "video",
  title: "Newton's laws",
  description: "Three laws of motion.",
  teacher: "Rahim Sir",
  youtube_id: ID,
  pdf: { available: false, name: "", size_bytes: 0 },
  category: { slug: "hsc", name: "HSC" },
  subject: { slug: "physics", name: "Physics" },
  exam: null,
  published_at: "2026-11-01T00:00:00Z",
  ...over,
});
const page = (results: Material[]) => ({ status: 200, body: { count: results.length, next: null, previous: null, results } });

async function open(routes: Parameters<typeof mockBackend>[0], language: "bn" | "en" = "en") {
  await resetDevice({ language, refresh: "R0" });
  const backend = mockBackend({
    "POST /auth/token/refresh/": { status: 200, body: { access: "A1", refresh: "R1" } },
    "GET /me/": { status: 200, body: { ...STUDENT, preferred_language: language } },
    ...routes,
  });
  await renderApp("/materials");
  return backend;
}

test("the YouTube address is built only from a valid 11-character ID", () => {
  expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  for (const bad of ["", "short", `${ID}x`, `${ID.slice(0, 10)}"`, "javascript:alert(1)"]) expect(youtubeWatchUrl(bad)).toBeNull();
});

// First on purpose: a spy on expo-linking only reaches the component in the first render of a file
// (same order dependence as tests/routine.test.tsx and tests/notifications.test.tsx).
test("a video opens on YouTube; a PDF opens through the API address; no sign-in call for the list", async () => {
  const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const backend = await open({
    "GET /public/materials/": page([item(), item({ id: 2, kind: "pdf", youtube_id: "", title: "Formula sheet", teacher: "", pdf: { available: true, name: "", size_bytes: 2048 } })]),
  });
  expect(await screen.findByText("Newton's laws")).toBeOnTheScreen();
  expect(screen.getByText("Teacher: Rahim Sir")).toBeOnTheScreen();
  expect(screen.getAllByText("HSC · Physics")).toHaveLength(2);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Watch Newton's laws on YouTube" }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(`https://www.youtube.com/watch?v=${ID}`));
  await user.press(screen.getByRole("button", { name: "Open the PDF: Formula sheet" }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(expect.stringMatching(/\/public\/materials\/2\/pdf\/$/)));
  expect(backend.find("GET", "/public/materials/")[0].headers.Authorization).toBeUndefined();
  opened.mockRestore();
});

test("the type filter asks the server for that type", async () => {
  const backend = await open({ "GET /public/materials/": page([item()]) });
  await screen.findByText("Newton's laws");
  await fireEvent.press(screen.getByRole("radio", { name: "Videos" }));
  await waitFor(() => expect(backend.find("GET", "/public/materials/").some((call) => call.query.kind === "video")).toBe(true));
});

test("an empty list says so", async () => {
  await open({ "GET /public/materials/": page([]) });
  expect(await screen.findByText("No study materials yet. Check back soon.")).toBeOnTheScreen();
});

test("a PDF with no file has no button", async () => {
  await open({ "GET /public/materials/": page([item({ kind: "pdf", youtube_id: "", title: "Empty handout" })]) });
  await screen.findByText("Empty handout");
  expect(screen.queryByRole("button", { name: /Open the PDF/ })).not.toBeOnTheScreen();
});

test("is available in Bangla", async () => {
  await open({ "GET /public/materials/": page([item()]) }, "bn");
  expect(await screen.findAllByText("স্টাডি ম্যাটেরিয়াল")).not.toHaveLength(0);
  expect(screen.getByText("শিক্ষক: Rahim Sir")).toBeOnTheScreen();
});
