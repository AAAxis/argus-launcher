import type {Toast} from '../hooks/useToast';
import type {CloudData} from './useCloudData';

// What every action hook needs: the data primitives, the way to tell the user,
// the one piece of selection state that mutations have to keep honest (a
// deleted profile cannot stay selected), and which proxies are mid-check (the
// background sweep, the manual re-check and the pre-launch gate all drive the
// same spinner).
//
// A set rather than a single id: "Check all" runs several curls at once, and a
// single id meant only one row could say "Checking…" while the rest sat looking
// idle. begin/end rather than a setter so two overlapping checks cannot clobber
// each other's spinner -- the previous single-value setter made the second one
// to finish clear the first one's.
export type WorkspaceCore = {
  data: CloudData;
  toast: Toast;
  selectedProfileId: string | null;
  setSelectedProfileId: (id: string | null) => void;
  checkingProxyIds: ReadonlySet<string>;
  beginProxyCheck: (id: string) => void;
  endProxyCheck: (id: string) => void;
};

// Re-exported so the existing workspace call sites keep their short local
// name; the implementation moved to lib/random.ts once drafts.ts needed it too.
export {newRowId as newId} from '../lib/random';
