// "Something other than the person at the keyboard is driving this window."
//
// Written into a launched profile's own user-data-dir as argus-automation.json.
// The browser fork watches that file (chrome/browser/argus/argus_automation_state)
// and paints a pulsing orange border around the page content while it says
// active, with a pill naming what holds the window.
//
// A FILE, rather than a socket or a CDP command, for three reasons:
//
//   1. It is the contract this pair already has. The launcher hands a launch its
//      proxy verdict, its theme and its run token by writing argus-session.json
//      and argus-launch.json into the same tree. A fourth file is a fourth row of
//      an existing pattern; a new port or a new DevTools domain is neither.
//   2. It survives both ends independently. The browser reads whatever is there
//      when it starts, so a window launched while a run was already in flight
//      glows immediately, and a launcher restart mid-run does not need a
//      reconnect protocol.
//   3. It is per-window by construction. Every profile has its own
//      user-data-dir, so there is no addressing problem and no chance of one
//      profile's state reaching another's window.
//
// Two things drive it, and they are told apart in the file rather than merged:
// an automation run (from anywhere -- the launcher's own button, a schedule, the
// start page, the side panel, an MCP call) and an AI/MCP tool driving the page
// directly. The first has a name worth showing; the second does not, and says so.

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'argus-automation.json';

// How long a written state stays believable without being refreshed.
//
// This is the whole answer to "the launcher was killed mid-run". Nothing can
// clear the file in that case -- the process that would have is gone -- so the
// file carries its own expiry and the browser treats a stale one as inactive. An
// orange border that never goes away would teach people to ignore the border,
// which is worse than one that occasionally clears a few seconds early.
//
// 45s, refreshed on every step a run logs. Long enough that a slow step (the
// 30s navigation timeout is the longest single wait a step can take) does not
// blink the border off mid-run; short enough that a crash does not leave it up
// for a minute.
const TTL_MS = 45000;

// How long an AI/MCP tool call keeps the border up after it returns.
//
// The MCP tools are one-shot by design: each opens a CDP socket, does one thing
// and closes it (electron/mcp/cdp.cjs). An agent working a page does that every
// few seconds, so the honest unit here is the session, not the call -- a border
// that blinked once per tool call would read as a rendering fault rather than a
// warning. This is the idle window after the last call before the window is
// declared the user's again.
const AI_IDLE_MS = 8000;

// `label` is shown to a person, so it is length-capped here rather than trusted:
// an automation name is user-supplied and a 400-character one would render as a
// pill wider than the window.
const MAX_LABEL = 60;

function filePathFor(userDataDir) {
  return path.join(userDataDir, FILE_NAME);
}

// Creates the writer. `resolveUserDataDir` is injected because resolving a
// profile id to its directory is main.cjs's job (it owns app.getPath), and
// keeping it out of here is what lets this file be required by a test with no
// Electron.
//
// `now` is injected for the same reason it is in run-token.cjs: the expiry
// behaviour is worth testing without sleeping.
function createDrivingState({resolveUserDataDir, now = () => Date.now()}) {
  // profileId -> timer that clears an AI marker once its idle window passes.
  const idleTimers = new Map();
  // profileId -> true while a run is in flight. An AI tool call arriving during
  // a run must not overwrite the run's own label with the vaguer "an AI tool":
  // the run is the more specific truth about the same fact, and it is the one
  // with a name worth reading.
  const runs = new Set();

  function write(profileId, state) {
    const dir = resolveUserDataDir(profileId);
    if (!dir) {
      return;
    }
    try {
      fs.writeFileSync(filePathFor(dir), JSON.stringify(state));
    } catch {
      // The directory can be gone (the profile was deleted) or read-only. A
      // window without a border is the whole cost, and it is not worth failing a
      // run over or worth a line in a log nobody reads.
    }
  }

  // Removed rather than rewritten to {active:false}: absent and inactive have to
  // mean the same thing anyway -- a window that has never run anything has no
  // file at all -- and one meaning is better than two.
  function clear(profileId) {
    const timer = idleTimers.get(profileId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(profileId);
    }
    runs.delete(profileId);
    const dir = resolveUserDataDir(profileId);
    if (!dir) {
      return;
    }
    try {
      fs.rmSync(filePathFor(dir), {force: true});
    } catch {
      // Same as write(): nothing here is worth interrupting a run for.
    }
  }

  return {
    AI_IDLE_MS,
    FILE_NAME,
    TTL_MS,

    // A run started, or logged a step. Idempotent, and called on every log entry
    // precisely so the expiry above keeps moving forward while the run works.
    runActive(profileId, label) {
      if (!profileId) return;
      runs.add(profileId);
      // A run outranks an AI marker for this profile: drop the pending idle
      // clear so it cannot delete the run's own state eight seconds from now.
      const timer = idleTimers.get(profileId);
      if (timer) {
        clearTimeout(timer);
        idleTimers.delete(profileId);
      }
      write(profileId, {
        active: true,
        kind: 'automation',
        label: String(label || '').slice(0, MAX_LABEL),
        expiresAt: now() + TTL_MS,
      });
    },

    // An AI/MCP tool touched this profile. Refreshes the idle window; ignored
    // while a run owns the window.
    aiActive(profileId) {
      if (!profileId || runs.has(profileId)) return;
      const existing = idleTimers.get(profileId);
      if (existing) {
        clearTimeout(existing);
      }
      write(profileId, {
        active: true,
        kind: 'ai',
        label: '',
        // The idle window and the staleness TTL are different clocks with
        // different jobs: this one says when the border SHOULD come down, the
        // TTL says when the browser may stop believing the file at all. The
        // written expiry is the later of the two so a tool call every seven
        // seconds keeps the border up continuously rather than flickering at
        // the TTL boundary.
        expiresAt: now() + Math.max(TTL_MS, AI_IDLE_MS),
      });
      // unref() so a pending border-down cannot hold the process open at quit.
      const timer = setTimeout(() => {
        idleTimers.delete(profileId);
        // Re-checked rather than assumed: a run may have started during the
        // idle window, and clearing here would take its border down with it.
        if (!runs.has(profileId)) {
          clear(profileId);
        }
      }, AI_IDLE_MS);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      idleTimers.set(profileId, timer);
    },

    // The run ended, the window was closed, or the app is quitting.
    idle(profileId) {
      if (!profileId) return;
      clear(profileId);
    },

    // Every profile this process ever marked, cleared. For quit: a border left
    // behind by a launcher that is no longer running would only come down when
    // its TTL lapsed, and the file would sit in the profile until the next run.
    idleAll() {
      for (const profileId of new Set([...runs, ...idleTimers.keys()])) {
        clear(profileId);
      }
    },
  };
}

module.exports = {AI_IDLE_MS, FILE_NAME, MAX_LABEL, TTL_MS, createDrivingState};
