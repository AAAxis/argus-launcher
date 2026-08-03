export function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

// Deterministic per-profile uint32: canvas/audio noise (argus_fingerprint_
// injector.cc's noiseAt()) is seeded by this, so a profile's noise is stable
// across relaunches unless the user opted into rotate_on_launch.
export function stableSeedFor(profileId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i++) {
    hash ^= profileId.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
