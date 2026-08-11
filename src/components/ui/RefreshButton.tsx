// "Refresh" -- pull the workspace again now, instead of waiting for the window
// to lose and regain focus.
//
// There is no realtime in this app: a colleague's edit reaches this machine on
// the focus refresh in WorkspaceProvider and nowhere else. That covers alt-tab,
// but not the case this button exists for -- sitting on the Profiles table
// while somebody else works the same list, where the window never loses focus
// and the table quietly goes stale with no way to say so.
//
// Lives in the .topbar beside Import and Add profile rather than in a table's
// own toolbar: what it pulls is the whole workspace -- proxies, cookies,
// hand-offs and the org's plan as well as the table you happen to be looking at.
//
// Drawn as .filter-trigger, the flat silhouette the status and tag filters take,
// rather than as a bordered button: see the .filter-trigger note in styles.css.
// Next to a solid Add profile, the border is what says which of the header's
// actions is the primary one.
//
// The spin is the whole of the feedback. A successful refresh usually changes
// nothing visible -- that is the normal case, not a failure -- so a toast
// saying so would fire on every click and mean nothing. Failures already toast
// from useCloudData.
import {useEffect, useRef, useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useWorkspace} from '../../workspace/WorkspaceProvider';

// A read against a warm connection can land in under 100ms, and an icon that
// starts and stops inside a tenth of a second reads as a rendering glitch
// rather than as work done. One full turn of .btn-spin's 0.8s period is the
// floor; a slower fetch simply keeps spinning past it.
const MIN_SPIN_MS = 800;

export function RefreshButton({label = 'Refresh'}: {label?: string}) {
  const {refresh} = useWorkspace();
  const [busy, setBusy] = useState(false);
  // Set on mount rather than only cleared on unmount: StrictMode's double
  // invoke would otherwise leave a still-mounted button flagged as gone, and
  // the spin would never stop.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleClick() {
    setBusy(true);
    const started = Date.now();
    try {
      await refresh();
    } finally {
      const rest = MIN_SPIN_MS - (Date.now() - started);
      if (rest > 0) {
        await new Promise((resolve) => setTimeout(resolve, rest));
      }
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <button
      className="filter-trigger refresh-trigger"
      // Disabled rather than queued: a second fetch of the same eight tables
      // while the first is in flight buys nothing.
      disabled={busy}
      onClick={() => void handleClick()}
      title="Pull the latest profiles, proxies and hand-offs"
      type="button"
    >
      <span className="filter-trigger-label">
        <RefreshCw className={busy ? 'btn-spin' : undefined} size={14} strokeWidth={2} />
        {label}
      </span>
    </button>
  );
}
