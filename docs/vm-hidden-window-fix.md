# Launch opens no window on GPU-less / RDP hosts (`--window-size`)

## Symptom

On a VM host with no real GPU (Azure Hyper-V, RDP-only servers), clicking **Launch**
appeared to do nothing. The browser was in fact starting every time — the process ran,
the assigned proxy passed its check, the start page loaded, and the remote-debugging
port answered — but **no window ever appeared on screen**. The v1.0.63–65 work
(software rendering + disabling `CalculateNativeWinOcclusion`) fixed painting but not
this: the window was never *shown* at all.

## Root cause

The window was created with its visible style bit (`WS_VISIBLE`) unset. On a
software-rendering host, Chromium creates the browser window but leaves it hidden when
the launch carries an explicit **`--window-size`** switch.

Isolated with a controlled A/B on one profile — the *only* variable being that switch:

| Launch args | Window |
|---|---|
| no `--window-size` | **visible** |
| `--window-size=2560,1440` | hidden |
| `--window-size=1400,900` (fits the display) | hidden |

It is the presence of the switch, not the size — a size that fits the display is hidden
too. Forcing `ShowWindow(SW_SHOWNORMAL)` on the hidden window made it appear, confirming
the window was fully live and only unshown. On real-GPU machines the same switch is
harmless and the window shows normally.

Where the switch comes from: `src/lib/fingerprint.ts` emits
`--window-size=<w>,<h>` from the profile's fingerprint screen on every launch.

## Fix

Drop `--window-size` **only on software-rendering hosts**, in
`electron/main.cjs` where the switch list is assembled for the spawn:

```js
const switches = hostNeedsSoftwareRendering() ?
  launchSafeSwitches(payload.commandLineSwitches)
      .filter((sw) => !/^--window-size(?:=|$)/.test(sw)) :
  launchSafeSwitches(payload.commandLineSwitches);
```

The filter lives here, not in `fingerprint.ts`, because only the main process knows
whether the host needs software rendering (`hostNeedsSoftwareRendering()`); the renderer
that builds the switch cannot see it.

No behavior change on real hardware, and no fingerprint regression: the window is still
sized to the profile's screen through the `browser.window_placement` preference that
`writeProfileFingerprintPrefs` already writes to each profile. That path sizes the
window without tripping the hidden-window bug — verified visible for both fitting and
oversized placements (Chromium clamps an oversized placement to the work area on show).
