import {pageSizeOptions} from '../../lib/paginate';
import type {ReactNode} from 'react';

export function PaginationBar({page, totalPages, total, pageSize, onPage, onPageSize, extra}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  // Optional caller-specific content (e.g. the selected-count on the Profiles
  // tab) rendered in the same row, before the range text.
  extra?: ReactNode;
}) {
  if (total === 0) {
    return null;
  }
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return (
    <section className="pagination-bar">
      {extra}
      <span className="pagination-range">{start}-{end} of {total}</span>
      <div className="pagination-controls">
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size} / page</option>)}
        </select>
        <button className="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="pagination-page">Page {page + 1} of {totalPages}</span>
        <button className="ghost" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </section>
  );
}
