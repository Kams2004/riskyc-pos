"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";

/** "Showing 11–20 of 34 sales" plus Prev / page numbers / Next — the same control on every POS list. */
export default function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  noun,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  /** Plural word for what's listed, e.g. "sales", "orders". */
  noun: string;
  onPageChange: (page: number) => void;
}) {
  const { t } = useT();
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <p className="text-xs text-gray-400">
        {t("pagination.showing", { from, to, total, noun })}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronLeft size={13} /> {t("pagination.prev")}
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p, idx, arr) => (
              <span key={p} className="flex items-center">
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-xs text-gray-300">…</span>}
                <button
                  onClick={() => onPageChange(p)}
                  className={clsx(
                    "w-7 h-7 rounded-lg text-xs font-semibold",
                    p === page ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  {p}
                </button>
              </span>
            ))}
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          >
            {t("pagination.next")} <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
