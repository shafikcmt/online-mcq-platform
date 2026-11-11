import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaterialCard } from "@/components/material-card";
import { VideoPlayer } from "@/components/video-player";
import { apiPath, embedUrl, isYoutubeId, materialsHref, parseMaterialFilters, thumbnailUrl, watchUrl, type Material } from "@/lib/materials";

const ID = "dQw4w9WgXcQ";
const material = (over: Partial<Material> = {}): Material => ({
  id: 3,
  kind: "video",
  title: "Newton's laws",
  description: "Three laws.",
  teacher: "Rahim Sir",
  youtube_id: ID,
  pdf: { available: false, name: "", size_bytes: 0 },
  category: { slug: "hsc", name: "HSC" },
  subject: { slug: "physics", name: "Physics" },
  exam: null,
  published_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("material filters", () => {
  it("keeps valid values and drops anything else", () => {
    expect(parseMaterialFilters({ kind: "pdf", category: "hsc", page: "3" })).toEqual({ kind: "pdf", category: "hsc", exam: "", page: 3 });
    expect(parseMaterialFilters({ kind: "<script>", category: "../x", page: "-1" })).toEqual({ kind: "", category: "", exam: "", page: 1 });
    expect(parseMaterialFilters({ kind: ["video", "pdf"] }).kind).toBe("video");
    expect(parseMaterialFilters({ page: "99999999" }).page).toBe(1);
  });

  it("builds the API path and page links from valid filters only", () => {
    expect(apiPath({ kind: "video", category: "hsc", exam: "physics-1", page: 2 })).toBe("materials/?page=2&page_size=12&kind=video&category=hsc&exam=physics-1");
    expect(materialsHref("bn", {})).toBe("/bn/materials");
    expect(materialsHref("en", { kind: "pdf", category: "hsc", exam: "p1", page: 2 })).toBe("/en/materials?kind=pdf&category=hsc&exam=p1&page=2")
    expect(parseMaterialFilters({ exam: "bad slug!" }).exam).toBe("");
  });
});

describe("YouTube addresses", () => {
  it("are built only from an 11-character ID", () => {
    expect(isYoutubeId(ID)).toBe(true);
    for (const bad of ["", "short", "x".repeat(12), `${ID}"onload=alert(1)`, "javascript:alert", "a b c d e f g"]) expect(isYoutubeId(bad)).toBe(false);
    expect(embedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`);
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(thumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});

describe("VideoPlayer", () => {
  it("loads nothing from YouTube until play is pressed, then embeds the privacy-friendly player", () => {
    render(<VideoPlayer id={ID} title="Newton" playLabel="Play video: Newton" watchLabel="Watch on YouTube" />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: "Watch on YouTube" })).toHaveAttribute("href", watchUrl(ID));
    fireEvent.click(screen.getByRole("button", { name: "Play video: Newton" }));
    const frame = document.querySelector("iframe")!;
    expect(frame).toHaveAttribute("src", embedUrl(ID));
    expect(frame).toHaveAttribute("title", "Newton");
  });

  it("renders nothing for an invalid ID", () => {
    expect(renderToStaticMarkup(<VideoPlayer id={'x"><script>'} title="t" playLabel="p" watchLabel="w" />)).toBe("");
  });
});

describe("MaterialCard", () => {
  it("a video shows its player, teacher and place", () => {
    const html = renderToStaticMarkup(<MaterialCard material={material()} lang="en" />);
    expect(html).toContain("Newton&#x27;s laws");
    expect(html).toContain("Teacher: Rahim Sir");
    expect(html).toContain("HSC · Physics");
    expect(html).toContain(thumbnailUrl(ID));
    expect(html).not.toContain("<iframe");
  });

  it("a PDF opens through the API address with its size, never a file path", () => {
    const html = renderToStaticMarkup(<MaterialCard material={material({ kind: "pdf", youtube_id: "", pdf: { available: true, name: "", size_bytes: 2048 } })} lang="en" />);
    expect(html).toContain('href="/api/v1/public/materials/3/pdf/"');
    expect(html).toContain("2 KB");
    expect(html).not.toContain("documents/");
  });

  it("a PDF without a file shows no button, and an exam link only when given", () => {
    const html = renderToStaticMarkup(<MaterialCard material={material({ kind: "pdf", youtube_id: "", exam: { slug: "physics-1", name: "Physics test" } })} lang="en" />);
    expect(html).not.toContain("Open PDF");
    expect(html).toContain('href="/en/exams/physics-1"');
  });
});
