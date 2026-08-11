import {useState} from 'react';

// A checkbox selection over a list, with the select-all-visible behaviour both
// tables need: toggling the header box clears the visible rows if they are all
// already checked, and adds them otherwise, leaving rows on other pages alone.
export function useSelection<T extends {id: string}>() {
  const [ids, setIds] = useState<Set<string>>(new Set());

  return {
    ids,
    size: ids.size,
    has: (id: string) => ids.has(id),
    clear: () => setIds(new Set()),
    toggle: (id: string) => setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    }),
    allSelected: (list: T[]) => list.length > 0 && list.every((item) => ids.has(item.id)),
    toggleAll: (list: T[]) => setIds((current) => {
      const allChecked = list.length > 0 && list.every((item) => current.has(item.id));
      const next = new Set(current);
      list.forEach((item) => (allChecked ? next.delete(item.id) : next.add(item.id)));
      return next;
    }),
    selectedFrom: (list: T[]) => list.filter((item) => ids.has(item.id)),
  };
}
