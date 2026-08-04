import type {Toast} from '../hooks/useToast';
import type {CloudData} from './useCloudData';

// What every action hook needs: the data primitives, the way to tell the user,
// the one piece of selection state that mutations have to keep honest (a
// deleted profile cannot stay selected), and which proxy is mid-check (the
// background sweep, the manual re-check and the pre-launch gate all drive the
// same spinner).
export type WorkspaceCore = {
  data: CloudData;
  toast: Toast;
  selectedProfileId: string | null;
  setSelectedProfileId: (id: string | null) => void;
  checkingProxyId: string;
  setCheckingProxyId: (id: string) => void;
};

// Re-exported so the existing workspace call sites keep their short local
// name; the implementation moved to lib/random.ts once drafts.ts needed it too.
export {newRowId as newId} from '../lib/random';
