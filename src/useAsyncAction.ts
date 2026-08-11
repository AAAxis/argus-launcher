import {useCallback, useState} from 'react';

// Tracks in-flight async button actions by a caller-chosen key, so any number
// of buttons (Save, Delete, Import, ...) can each show independent
// busy/disabled/spinner state without every call site inventing its own
// useState pair (which is how Save/Delete ended up with no feedback at all
// while only the CSV importer had one, ad hoc, text-only).
export function useAsyncAction() {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setPending((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setPending((prev) => {
        if (!prev.has(key)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);

  return {run, isPending};
}
