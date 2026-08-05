// Running the same async job over a list, a few at a time.
//
// The app had two speeds before this and neither fits checking the proxies in
// an import: the background sweep is a sequential `for … await`
// (hooks/useBackgroundWork.ts), which would take minutes on a 200-row file, and
// a plain Promise.all would spawn one `curl` per row at once -- the exact
// failure the proxy importer already refuses to cause ("importing 200 proxies
// would mean 200 concurrent curl runs", workspace/useProxyActions.ts).
//
// Results come back in the order the items went in, not the order they
// finished, so a caller can zip them back against its own list.
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (!items.length) {
    return results;
  }
  // A shared cursor rather than fixed slices: proxy checks time out at wildly
  // different speeds (a dead one takes the full 10s budget, a live one ~100ms),
  // so a worker that draws a batch of dead ones would otherwise hold the whole
  // pass open while the others idle.
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await run(items[index], index);
    }
  }
  await Promise.all(
      Array.from({length: Math.max(1, Math.min(limit, items.length))}, () => worker()));
  return results;
}
