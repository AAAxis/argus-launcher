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

export function newId(suffix?: string | number) {
  return globalThis.crypto?.randomUUID?.() ||
    (suffix === undefined ? `${Date.now()}` : `${Date.now()}-${suffix}`);
}
