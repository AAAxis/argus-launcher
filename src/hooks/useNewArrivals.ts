// The "new since you last looked" marker, for the whole app.
//
// One hook, called once from App.tsx, because the two halves of the feature
// cannot live in the tabs that show them. The sidebar has to count arrivals on
// tabs you are NOT standing on -- which is the part that was missing while this
// logic sat inside AutomationsTab -- and the row tint has to hold steady across
// the same renders in which the count is being cleared.
//
// The rule itself is in src/lib/newSince.ts and is deliberately not repeated
// here. This file owns three things: the mapping from each table's row type to
// an Arrival, and the two watermarks per kind described below.
import {useEffect, useMemo, useRef, useState} from 'react';
import {arrivalsSince, newestCreatedAt, NEW_KINDS, readWatermark, writeWatermark} from
  '../lib/newSince';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import type {Arrival, NewKind} from '../lib/newSince';
import type {TabId} from '../data/tabs';

export type NewArrivals = {
  // Keyed by TabId rather than NewKind so the sidebar can look a count up by the
  // nav item it is drawing, without knowing that only four of ten tabs have one.
  counts: Partial<Record<TabId, number>>;
  newIds: Record<NewKind, ReadonlySet<string>>;
};

type Marks = Record<NewKind, string>;

// The four tabs that show arrivals. Every other TabId simply has no entry in
// `counts`, which is what makes the badge in Shell.tsx a plain truthiness check.
const KIND_FOR_TAB: Partial<Record<TabId, NewKind>> = {
  profiles: 'profiles',
  proxies: 'proxies',
  cookies: 'cookies',
  automations: 'automations',
};

function readAll(orgId: string | null, userId: string | null): Marks {
  return {
    profiles: readWatermark('profiles', orgId, userId),
    proxies: readWatermark('proxies', orgId, userId),
    cookies: readWatermark('cookies', orgId, userId),
    automations: readWatermark('automations', orgId, userId),
  };
}

export function useNewArrivals(activeTab: TabId): NewArrivals {
  const {orgId, userId} = useOrg();
  const {data} = useWorkspace();
  const {state} = data;
  const activeKind = KIND_FOR_TAB[activeTab];

  // What localStorage says. Advanced whenever you are standing on a tab, so it
  // is what the sidebar counts against -- opening a tab empties its badge.
  const [stored, setStored] = useState<Marks>(() => readAll(orgId, userId));
  // The value `stored` held at the instant you arrived on a tab, kept until you
  // leave it. This is what the green rows compare against, and the difference
  // between the two is the entire trick: without it, advancing the watermark to
  // clear the badge would un-highlight the very rows you opened the tab to read,
  // in the same commit.
  const [frozen, setFrozen] = useState<Marks>(stored);
  // Read by the freeze effect, which must see the current marks without
  // re-running every time they change -- re-running is what it exists to avoid.
  const storedRef = useRef(stored);
  storedRef.current = stored;

  // Each table narrowed to what the rule needs. `foreign` is set here and only
  // here: an automation written by an agent over MCP carries this user's uuid in
  // created_by, because the agent authenticates as them.
  const arrivals: Record<NewKind, Arrival[]> = useMemo(() => ({
    profiles: state.profiles,
    proxies: state.proxies,
    cookies: state.cookies,
    automations: state.automations.map((automation) => ({
      ...automation,
      foreign: automation.created_via === 'mcp',
    })),
  }), [state.profiles, state.proxies, state.cookies, state.automations]);

  // Switching workspace or signing in as somebody else invalidates both marks:
  // the keys are scoped by (kind, org, user), so every one of them is a
  // different key now. Re-read, and unfreeze -- there is no visit in progress
  // against the old workspace's numbers.
  useEffect(() => {
    const fresh = readAll(orgId, userId);
    storedRef.current = fresh;
    setStored(fresh);
    setFrozen(fresh);
  }, [orgId, userId]);

  // Freeze on arrival. Declared BEFORE the advancing effect below so that within
  // one commit it captures the mark first and the advance overwrites it second
  // -- the other order would freeze the value the advance had already moved, and
  // nothing would ever look new.
  useEffect(() => {
    if (!activeKind) {
      return;
    }
    const kind = activeKind;
    setFrozen((current) => current[kind] === storedRef.current[kind] ?
      current :
      {...current, [kind]: storedRef.current[kind]});
  }, [activeKind]);

  // Advance while you are standing there. Re-runs as rows arrive on the
  // window-focus refresh too, so a row that lands under your eyes still glows
  // (frozen is older) without ever raising a badge on the tab you are reading.
  useEffect(() => {
    if (!activeKind) {
      return;
    }
    const kind = activeKind;
    const newest = newestCreatedAt(arrivals[kind]);
    if (!newest) {
      return;
    }
    setStored((current) => {
      if (newest <= current[kind]) {
        return current;
      }
      writeWatermark(kind, orgId, userId, newest);
      return {...current, [kind]: newest};
    });
  }, [activeKind, arrivals, orgId, userId]);

  const newIds = useMemo(() => ({
    profiles: arrivalsSince(arrivals.profiles, frozen.profiles, userId),
    proxies: arrivalsSince(arrivals.proxies, frozen.proxies, userId),
    cookies: arrivalsSince(arrivals.cookies, frozen.cookies, userId),
    automations: arrivalsSince(arrivals.automations, frozen.automations, userId),
  }), [arrivals, frozen, userId]);

  const counts = useMemo(() => {
    const next: Partial<Record<TabId, number>> = {};
    for (const kind of NEW_KINDS) {
      // Against `stored`, not `frozen`: the badge is the thing that must clear
      // the moment you open the tab.
      const size = arrivalsSince(arrivals[kind], stored[kind], userId).size;
      if (size > 0) {
        next[kind] = size;
      }
    }
    return next;
  }, [arrivals, stored, userId]);

  return {counts, newIds};
}
