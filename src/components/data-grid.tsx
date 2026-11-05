"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search, SlidersHorizontal, X } from "lucide-react";

export type GridColumn<T> = {
  key: string;
  header: string;
  /** Right-aligned mono cell for money/quantity. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
};

export type GridFacet = { key: string; label: string; count: number };

/**
 * Zone D2 — dense operational data grid:
 * search + facet chips with counts, sortable headers, row selection with bulk
 * action bar, right-aligned mono numerics, pagination footer, row → inspector.
 */
export function EnterpriseDataGrid<T extends { id: string }>({
  rows,
  columns,
  facets,
  activeFacet = "all",
  facetKey,
  onRowOpen,
  bulkActions,
  emptyState,
  pageSizeOptions = [10, 20, 50],
  caption,
}: {
  rows: T[];
  columns: GridColumn<T>[];
  facets?: GridFacet[];
  activeFacet?: string;
  facetKey?: (row: T) => string;
  onRowOpen?: (row: T) => void;
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  emptyState?: ReactNode;
  pageSizeOptions?: number[];
  caption?: string;
}) {
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState(activeFacet);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(pageSizeOptions[1] ?? 20);
  const [page, setPage] = useState(0);
  const [dense, setDense] = useState(true);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = rows;
    if (facet !== "all" && facetKey) list = list.filter((row) => facetKey(row) === facet);
    if (term) {
      list = list.filter((row) =>
        columns.some((column) => {
          const raw = column.sortValue ? column.sortValue(row) : "";
          return String(raw).toLowerCase().includes(term);
        }),
      );
    }
    if (sort) {
      const column = columns.find((item) => item.key === sort.key);
      if (column?.sortValue) {
        list = [...list].sort((a, b) => {
          const left = column.sortValue!(a);
          const right = column.sortValue!(b);
          if (typeof left === "number" && typeof right === "number") {
            return sort.dir === "asc" ? left - right : right - left;
          }
          return sort.dir === "asc"
            ? String(left).localeCompare(String(right))
            : String(right).localeCompare(String(left));
        });
      }
    }
    return list;
  }, [columns, facet, facetKey, query, rows, sort]);

  useEffect(() => {
    setPage(0);
  }, [query, facet, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selectedRows = filtered.filter((row) => selected.includes(row.id));
  const allSelected = slice.length > 0 && slice.every((row) => selected.includes(row.id));

  function toggleSort(key: string) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return (
    <section className="panel min-w-0">
      {/* Integrated toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2">
        <label className="flex h-8 min-w-0 flex-1 basis-48 items-center gap-2 rounded-sm border border-ink-200 bg-paper px-2">
          <Search size={13} className="shrink-0 text-ink-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari di semua kolom…"
            className="min-w-0 flex-1 basis-0 bg-transparent text-[0.8125rem] outline-none placeholder:text-ink-400"
            aria-label="Cari baris tabel"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Bersihkan pencarian" className="text-ink-400 hover:text-ink-700">
              <X size={12} />
            </button>
          ) : (
            <span className="kbd shrink-0 text-ink-300">/</span>
          )}
        </label>

        <button
          type="button"
          onClick={() => setDense((value) => !value)}
          className="btn btn-ghost h-8 py-0 text-[0.75rem]"
          aria-pressed={dense}
          title="Kerapatan baris"
        >
          <SlidersHorizontal size={13} />
          {dense ? "Compact" : "Standard"}
        </button>

        <button
          type="button"
          onClick={() => {
            const header = columns.map((column) => column.header).join(";");
            const body = filtered
              .map((row) => columns.map((column) => `"${String(column.sortValue ? column.sortValue(row) : "").replace(/"/g, '""')}"`).join(";"))
              .join("\r\n");
            const blob = new Blob([`\uFEFF${header}\r\n${body}`], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "katalis-ekspor.csv";
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="btn btn-ghost h-8 py-0 text-[0.75rem]"
        >
          <Download size={13} /> CSV
        </button>
      </div>

      {facets && facets.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-ink-100 bg-ink-50/60 px-3 py-1.5">
          {facets.map((item) => {
            const active = facet === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFacet(item.key)}
                className={`rounded-xs px-2 py-0.5 text-[0.75rem] font-medium transition-colors ${
                  active ? "bg-ink-900 text-paper" : "text-ink-600 hover:bg-ink-200 hover:text-ink-900"
                }`}
              >
                {item.label}
                <span className={`num ml-1 ${active ? "text-ink-300" : "text-ink-400"}`}>{item.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {slice.length === 0 ? (
        <div className="px-3.5 py-6">{emptyState ?? <p className="text-[0.8125rem] text-ink-500">Tidak ada baris cocok.</p>}</div>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="data-table">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className="bg-ink-50/90">
              <tr>
                {bulkActions ? (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua baris halaman ini"
                      checked={allSelected}
                      onChange={(event) => {
                        const ids = slice.map((row) => row.id);
                        setSelected((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...ids]))
                            : current.filter((id) => !ids.includes(id)),
                        );
                      }}
                    />
                  </th>
                ) : null}
                {columns.map((column) => {
                  const isSorted = sort?.key === column.key;
                  return (
                    <th key={column.key} className={column.numeric ? "text-right" : undefined} style={column.width ? { width: column.width } : undefined}>
                      <button
                        type="button"
                        onClick={() => column.sortValue && toggleSort(column.key)}
                        className={`inline-flex items-center gap-1 ${column.numeric ? "flex-row-reverse" : ""} ${
                          column.sortValue ? "hover:text-ink-900" : "cursor-default"
                        }`}
                      >
                        {column.header}
                        {column.sortValue ? (
                          isSorted ? (
                            sort?.dir === "asc" ? (
                              <ArrowUp size={10} />
                            ) : (
                              <ArrowDown size={10} />
                            )
                          ) : (
                            <ChevronsUpDown size={10} className="text-ink-300" />
                          )
                        ) : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => {
                const isSelected = selected.includes(row.id);
                return (
                  <tr
                    key={row.id}
                    className={`${onRowOpen ? "cursor-pointer" : ""} ${isSelected ? "bg-ink-50" : ""}`}
                    onClick={() => onRowOpen?.(row)}
                  >
                    {bulkActions ? (
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Pilih baris"
                          checked={isSelected}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`${column.numeric ? "num text-right" : ""} ${dense ? "py-1.5" : ""}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: range, page size, navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-3 py-2 text-[0.75rem] text-ink-600">
        <span className="num">
          Menampilkan {filtered.length === 0 ? 0 : safePage * pageSize + 1}–{Math.min(filtered.length, (safePage + 1) * pageSize)} dari{" "}
          {filtered.length} baris
        </span>
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">
            <span className="text-ink-500">Baris</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-xs border border-ink-200 bg-paper px-1 py-0.5 text-[0.75rem]"
              aria-label="Baris per halaman"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            className="btn btn-ghost h-7 py-0 text-[0.75rem]"
          >
            Sebelumnya
          </button>
          <span className="num">
            {safePage + 1}/{pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            className="btn btn-ghost h-7 py-0 text-[0.75rem]"
          >
            Berikutnya
          </button>
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selectedRows.length > 0 && bulkActions ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-paper shadow-[0_18px_40px_-24px_rgba(18,17,16,0.6)]">
            <span className="num text-[0.8125rem]">{selectedRows.length} dipilih</span>
            {bulkActions(selectedRows, () => setSelected([]))}
            <button type="button" onClick={() => setSelected([])} className="text-[0.75rem] text-ink-300 underline">
              Batalkan
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
