import {supabase} from '../supabase';

export {supabase};

// src/supabase.ts exports null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are missing, so the app still boots (and shows its sign-in shell) without
// env. Reads degrade to empty lists; writes fail loudly rather than pretending
// to succeed -- the blob-era writer reported success in this case, which
// silently dropped every change until the next reload.
export class CloudUnavailableError extends Error {
  constructor() {
    super('Supabase env is missing in .env');
    this.name = 'CloudUnavailableError';
  }
}

export type Client = NonNullable<typeof supabase>;

export function requireClient(): Client {
  if (!supabase) {
    throw new CloudUnavailableError();
  }
  return supabase;
}

// Reads use this instead: no client means no data, which every list caller
// already handles, and it keeps a missing .env from throwing on boot.
export function optionalClient(): Client | null {
  return supabase;
}

export const STORAGE_BUCKET = 'global';

// Postgrest errors are plain objects, not Error instances.
export type DbError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

// Every db function funnels its error here so a caller only has to check the
// returned value/catch once. Throwing (rather than returning {error}) keeps the
// call sites in main.tsx short: they already sit inside try/catch or an
// async action wrapper.
export function raise(error: DbError | null, context: string): void {
  if (!error) {
    return;
  }
  const wrapped = new Error(error.message || `${context} failed`);
  (wrapped as Error & {dbError?: DbError}).dbError = error;
  throw wrapped;
}
