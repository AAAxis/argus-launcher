// Everything that mutates the workspace's model endpoints, plus the one thing
// that is not a mutation: keeping the main process's copy current.
//
// That push is the reason this file is a hook rather than three calls in the
// settings section. The renderer owns the data and the main process owns the
// outbound request, so a run cannot resolve a provider unless someone has
// handed the list over first -- and that has to happen on load and on every
// edit, not when a dialog happens to be open. See electron/automation/ai.cjs.
import {useCallback, useEffect} from 'react';
import * as db from '../db';
import {native} from '../native';
import {runtimeProvider} from '../data/aiProviders';
import {newId} from './core';
import type {WorkspaceCore} from './core';
import type {ArgusAiProvider} from '../types';

export type AiProviderActions = ReturnType<typeof useAiProviderActions>;

export function useAiProviderActions({data}: WorkspaceCore) {
  const {state, withDbError, patch} = data;
  const providers = state.ai_providers;

  // Mirrored into the main process whenever the list changes, including the
  // first time it is empty -- clearing matters as much as filling, or a
  // provider deleted here stays runnable until the app restarts.
  //
  // Memory only over there, never written to disk. The dependency is the list
  // itself: useCloudData replaces the array on every load, so this fires on
  // sign-in, on an org switch and on any edit below.
  useEffect(() => {
    void native?.setAiProviders?.(providers.map(runtimeProvider));
  }, [providers]);

  function blank(): ArgusAiProvider {
    return {
      id: newId(),
      name: '',
      kind: 'openai',
      model: '',
      // The first provider a workspace adds is its default. Nothing else would
      // be: a lone provider that is not the default makes every AI step
      // authored without naming one fail for no reason the user can see.
      is_default: providers.length === 0,
    };
  }

  async function save(provider: ArgusAiProvider, exists: boolean): Promise<string | null> {
    const error = await withDbError(
        (activeOrgId) => db.aiProviders.save(activeOrgId, provider, exists));
    if (error) {
      return error;
    }
    patch.aiProviders((list) => exists ?
      list.map((item) => (item.id === provider.id ? provider : item)) :
      [...list, provider]);
    return null;
  }

  async function remove(id: string): Promise<boolean> {
    const error = await withDbError((activeOrgId) => db.aiProviders.remove(activeOrgId, [id]));
    if (error) {
      return false;
    }
    patch.aiProviders((list) => list.filter((item) => item.id !== id));
    return true;
  }

  const setDefault = useCallback(async (id: string): Promise<boolean> => {
    const error = await withDbError(
        (activeOrgId) => db.aiProviders.setDefault(activeOrgId, id));
    if (error) {
      return false;
    }
    // Mirrors what the two statements did in the database, in the same order.
    patch.aiProviders((list) => list.map((item) => ({...item, is_default: item.id === id})));
    return true;
  }, [patch, withDbError]);

  return {blank, save, remove, setDefault};
}
