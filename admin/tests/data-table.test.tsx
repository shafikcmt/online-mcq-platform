import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataTable, nextOrdering, type Column } from "@/components/ui/data-table";
import { Pagination, pageWindow } from "@/components/ui/pagination";

import { renderWithI18n } from "./helpers";

type Row = { id: number; name: string; updated: string };
const rows: Row[] = [
  { id: 1, name: "Alpha", updated: "1 Oct" },
  { id: 2, name: "Beta", updated: "2 Oct" },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", sortField: "name_en", hideOnMobile: true, cell: (row) => row.name },
  { key: "updated", header: "Updated", sortField: "updated_at", sortFirst: "desc", cell: (row) => row.updated },
  { key: "plain", header: "Plain", cell: () => "x" },
];

describe("DataTable", () => {
  it("renders a captioned table with column headers and aria-sort", () => {
    renderWithI18n(
      <DataTable caption="Things" rows={rows} rowKey={(row) => row.id} columns={columns} ordering="-updated_at" onSort={() => {}} mobileTitle={(row) => row.name} />,
    );
    const table = screen.getByRole("table", { name: "Things" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual(["none", "descending", null]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    // Phone layout: a labelled list with the same rows (hidden by CSS at md+).
    expect(screen.getByRole("list", { name: "Things" }).querySelectorAll("li")).toHaveLength(2);
  });

  it("reports the next ordering when a sortable header is clicked", () => {
    const onSort = vi.fn();
    renderWithI18n(
      <DataTable caption="Things" rows={rows} rowKey={(row) => row.id} columns={columns} ordering="name_en" onSort={onSort} mobileTitle={(row) => row.name} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Name, sorted ascending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Updated" }));
    expect(onSort.mock.calls).toEqual([["-name_en"], ["-updated_at"]]);
    expect(nextOrdering("-name_en", "name_en")).toBe("name_en");
    expect(nextOrdering("sort_order", "name_en")).toBe("name_en");
  });

  it("marks itself busy while a new page loads", () => {
    renderWithI18n(
      <DataTable caption="Things" rows={rows} rowKey={(row) => row.id} columns={columns} busy mobileTitle={(row) => row.name} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Updating the list…");
  });
});

describe("Pagination", () => {
  it("computes a compact page window", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(6, 20)).toEqual([1, null, 5, 6, 7, null, 20]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("shows the range and moves between server pages", () => {
    const onPage = vi.fn();
    const onPageSize = vi.fn();
    renderWithI18n(<Pagination page={2} pageSize={20} count={45} onPage={onPage} onPageSize={onPageSize} />);
    expect(screen.getByText("Showing 21–40 of 45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });
    expect(onPage.mock.calls).toEqual([[3], [1]]);
    expect(onPageSize).toHaveBeenCalledWith(50);
  });

  it("disables next on the last page and hides page buttons for one page", () => {
    const { rerender } = renderWithI18n(<Pagination page={3} pageSize={20} count={45} onPage={() => {}} onPageSize={() => {}} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    rerender(<Pagination page={1} pageSize={20} count={0} onPage={() => {}} onPageSize={() => {}} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
