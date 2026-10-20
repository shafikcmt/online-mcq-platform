import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar, FilterSelect, SEARCH_DEBOUNCE_MS, SearchInput } from "@/components/ui/filter-bar";

import { renderWithI18n } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SearchInput", () => {
  it("reports once after typing pauses, trimmed", () => {
    const onChange = vi.fn();
    renderWithI18n(<SearchInput id="s" label="Search" placeholder="Search" value="" onChange={onChange} />);
    const box = screen.getByLabelText("Search");
    fireEvent.change(box, { target: { value: "ph" } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(box, { target: { value: " physics " } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(onChange.mock.calls).toEqual([["physics"]]);
  });

  it("applies at once on Enter, clears with the clear button, and follows outside changes", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(<SearchInput id="s" label="Search" placeholder="" value="" onChange={onChange} />);
    const box = screen.getByLabelText("Search");
    fireEvent.change(box, { target: { value: "light" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("light");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    rerender(<SearchInput id="s" label="Search" placeholder="" value="from-url" onChange={onChange} />);
    expect(box).toHaveValue("from-url");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(onChange).toHaveBeenCalledTimes(2); // an outside change is not echoed back
  });
});

describe("FilterBar", () => {
  it("renders filters inline and in the phone sheet with unique ids, and clears them", () => {
    vi.useRealTimers();
    const onClear = vi.fn();
    renderWithI18n(
      <FilterBar
        search={<span>search</span>}
        activeCount={1}
        onClear={onClear}
        filters={(prefix) => (
          <FilterSelect id={`${prefix}-status`} label="Status" value="true" onChange={() => {}} options={[{ value: "true", label: "Active" }]} />
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog.querySelector("#sheet-filter-status")).not.toBeNull();
    expect(document.querySelector("#filter-status")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(onClear).toHaveBeenCalled();
  });
});
