import { useEffect, useMemo, useState } from "react";

/**
 * Client-side paging over an already-loaded list. `resetKey` is anything whose change should send the
 * user back to page 1 (a search box, a tab) — pass an array or a joined string for several.
 */
export function usePagination<T>(items: T[], pageSize = 10, resetKey: unknown = undefined) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(resetKey ?? null);
  useEffect(() => {
    setPage(1);
  }, [key]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // A list that shrank (item deleted, filter narrowed) never leaves the user on an empty page past the end.
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  return { page: safePage, setPage, pageSize, totalPages, total: items.length, pageItems };
}
