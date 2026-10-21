import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/results/x" }));

import { ResultDetail } from "@/components/results/result-detail";

import { adminResult, exam, renderPanel } from "./content-helpers";

const region = (name: string) => screen.getByRole("region", { name });
const value = (scope: HTMLElement, label: string) => within(scope).getByText(label).nextElementSibling;

describe("ResultDetail", () => {
  it("shows score, attempt timing and stored merit as definitions", () => {
    renderPanel(<ResultDetail result={adminResult()} exam={exam({ status: "published" })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ayesha Siddika" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Model test" })).toHaveAttribute("href", "/exams/7");
    const score = region("Score");
    expect(value(score, "Marks obtained")).toHaveTextContent("2.00 of 3.00");
    expect(value(score, "Percentage")).toHaveTextContent("66.67%");
    expect(value(score, "Result")).toHaveTextContent("Passed");
    expect(value(score, "Correct")).toHaveTextContent("2");
    expect(value(score, "Wrong")).toHaveTextContent("0");
    expect(value(score, "Unanswered")).toHaveTextContent("1");
    const attempt = region("Attempt and timing");
    expect(value(attempt, "Status")).toHaveTextContent("Submitted");
    expect(value(attempt, "Submitted by")).toHaveTextContent("By the student");
    expect(value(attempt, "Time used")).toHaveTextContent("12 min 34 s");
    expect(value(attempt, "Submitted at")).toHaveTextContent("1 Oct 2026");
    const merit = region("Merit");
    expect(value(merit, "Merit list")).toHaveTextContent("Counts for merit");
    expect(value(merit, "Merit position")).toHaveTextContent("2");
    expect(screen.getByText("Answers are not shown in the Admin Panel.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All results of this student" })).toHaveAttribute("href", "/results?user=40");
    expect(screen.getByRole("link", { name: "Back to results" })).toHaveAttribute("href", "/results?exam=7");
  });

  it("visibility = the exam setting + the server's results_visible (not derived)", () => {
    const { unmount } = renderPanel(
      <ResultDetail result={adminResult()} exam={exam({ result_visibility: "immediate", results_visible: false })} />,
    );
    const visibility = region("Visibility");
    expect(value(visibility, "Result setting")).toHaveTextContent("Immediately after submission");
    expect(value(visibility, "Right now")).toHaveTextContent("Students can't see the results now");
    expect(within(visibility).getByRole("link", { name: "Manage visibility and merit for this exam" })).toHaveAttribute(
      "href",
      "/results?exam=7",
    );
    unmount();
    renderPanel(<ResultDetail result={adminResult()} exam={exam({ result_visibility: "manual", results_visible: true })} />);
    expect(value(region("Visibility"), "Right now")).toHaveTextContent("Students can see the results now");
  });

  it("unranked, failed, no pass mark and server-finalized attempts read correctly", () => {
    const { unmount } = renderPanel(
      <ResultDetail
        result={adminResult({ merit_position: null, is_merit_counted: false, is_passed: false, status: "auto_submitted", submit_source: "server_auto" })}
        exam={null}
      />,
    );
    expect(value(region("Merit"), "Merit position")).toHaveTextContent("Not ranked");
    expect(value(region("Merit"), "Merit list")).toHaveTextContent("Not counted");
    expect(value(region("Score"), "Result")).toHaveTextContent("Failed");
    expect(value(region("Attempt and timing"), "Status")).toHaveTextContent("Submitted automatically");
    expect(value(region("Attempt and timing"), "Submitted by")).toHaveTextContent("Finalized by the server");
    expect(within(region("Visibility")).queryByText("Right now")).not.toBeInTheDocument(); // exam unknown
    unmount();
    renderPanel(<ResultDetail result={adminResult({ is_passed: null })} exam={null} />);
    expect(value(region("Score"), "Result")).toHaveTextContent("No pass mark");
  });

  it("renders no answer content (the row has none)", () => {
    const { container } = renderPanel(<ResultDetail result={adminResult()} exam={exam()} />);
    expect(container.textContent).not.toMatch(/option|correct answer|explanation/i);
  });

  it("Bangla", () => {
    renderPanel(<ResultDetail result={adminResult({ user_full_name: "মাহমুদা আক্তার" })} exam={exam({ results_visible: true })} />, "bn");
    expect(screen.getByRole("heading", { level: 1, name: "মাহমুদা আক্তার" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "মডেল টেস্ট" })).toBeInTheDocument();
    expect(value(region("নম্বর"), "প্রাপ্ত নম্বর")).toHaveTextContent("3.00-এর মধ্যে 2.00");
    expect(value(region("দৃশ্যমানতা"), "এখন")).toHaveTextContent("শিক্ষার্থীরা এখন ফলাফল দেখতে পাচ্ছে");
    expect(screen.getByRole("link", { name: "ফলাফলের তালিকায় ফিরে যান" })).toBeInTheDocument();
  });
});
