export const pageSizeOptions = [25, 50, 100];

// Clamps the requested page into range so a shrinking list (filter/delete)
// never leaves the view stuck on a now-empty trailing page.
export function paginate<T>(list: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    total: list.length,
  };
}
