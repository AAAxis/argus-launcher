// The fingerprint editor's form. Split out of the profile dialog because it is
// the one part of it that is genuinely reusable -- anything that edits a
// browser identity needs exactly these fields.
//
// Twenty-two controls in one flat two-column grid gave no clue which of them
// were related, so they are grouped by what a detection site is actually
// reading: who the browser claims to be, what machine it claims to run on, and
// what it does to the APIs that would otherwise fingerprint it uniquely.
import {
  AlertTriangle, Cpu, Fingerprint, Gauge, Globe, Languages, MapPin, Monitor, ShieldCheck,
  Smartphone, Video,
} from 'lucide-react';
import {
  browserVersionPresets,
  cpuPresets,
  gpuPresets,
  languagePresets,
  mediaDevicePresets,
  memoryPresets,
  mobileDevicePatternsFor,
  noiseModes,
  realisticWindowsFingerprintPatterns,
  screenPresets,
  timezoneGroups,
  webGpuModes,
  webRtcModes,
  AUTO_FROM_PROXY,
} from '../../lib/fingerprintPresets';
import {Field} from '../ui/Field';
import {FormGroup} from '../ui/FormGroup';
import {PlatformPicker} from '../ui/PlatformPicker';
import {withFingerprintOs} from '../../drafts';
import chromeLogo from '../../assets/platform/chrome.svg';
import type {ProfileDraft} from '../../drafts';
import type {TimezoneMismatch} from '../../lib/proxyGeo';

export function FingerprintFields({draft, onChange, requestTimezone, timezoneWarning}: {
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  // Lets the owner intercept a timezone change it may want to confirm first --
  // see TimezoneOverrideModal. Optional so the form stays usable on its own;
  // without it the select writes straight through, as it always did.
  requestTimezone?: (value: string) => void;
  // A standing mismatch between the chosen zone and the assigned proxy. The
  // confirmation dialog only fires when the *timezone* changes, so this is what
  // catches the other direction: swapping the proxy under a zone that was
  // coherent when it was picked, which changes nothing on this form and would
  // otherwise be invisible until a detection site pointed it out.
  timezoneWarning?: TimezoneMismatch | null;
}) {
  const set = (patch: Partial<ProfileDraft>) => onChange({...draft, ...patch});
  const isMobile = draft.fingerprint_os === 'Android' || draft.fingerprint_os === 'iOS';

  return (
    <>
      <FormGroup
        title="Identity"
        hint="Who the browser says it is. The platform decides what the rest of this dialog is allowed to be — picking it re-rolls the hardware below."
      >
        {/* The one control writing fingerprint_os. It used to render here and
          * again on the profile dialog's main form; the main form now carries
          * the Fingerprint card instead, directly under Proxy, so the platform
          * is still one click from the top of the form rather than buried. */}
        <Field label="Operating system" icon={<Fingerprint size={14} />} wide group>
          <PlatformPicker
            label="Operating system"
            value={draft.fingerprint_os}
            onChange={(os) => onChange(withFingerprintOs(draft, os))}
          />
        </Field>
        <Field label="Browser version" icon={<img alt="" src={chromeLogo} width={14} height={14} />}>
          <select
            value={draft.fingerprint_browser_version}
            onChange={(event) => set({fingerprint_browser_version: event.target.value})}
          >
            {browserVersionPresets.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Language" icon={<Languages size={14} />}>
          <input
            type="text"
            list="language-presets"
            value={draft.fingerprint_language}
            onChange={(event) => set({fingerprint_language: event.target.value})}
          />
        </Field>
        <Field label="User agent" icon={<Globe size={14} />} wide>
          <input
            type="text"
            placeholder="Auto when empty"
            value={draft.fingerprint_user_agent}
            onChange={(event) => set({fingerprint_user_agent: event.target.value})}
          />
        </Field>
        {/* A grouped select rather than the free-text datalist this replaces:
          * the old control accepted any string, so a typo produced a zone the
          * browser silently ignored at launch. */}
        <Field label="Timezone" icon={<Globe size={14} />}>
          <select
            value={draft.fingerprint_timezone}
            onChange={(event) => requestTimezone ?
              requestTimezone(event.target.value) :
              set({fingerprint_timezone: event.target.value})}
          >
            <option value={AUTO_FROM_PROXY}>{AUTO_FROM_PROXY}</option>
            {timezoneGroups.map((group) => (
              <optgroup label={group.region} key={group.region}>
                {group.zones.map((zone) => (
                  <option value={zone.name} key={zone.name}>{zone.label}</option>
                ))}
              </optgroup>
            ))}
            {/* A profile saved before this list existed, or imported with a zone
              * outside it, would otherwise show as blank and be silently
              * rewritten on the next save. */}
            {isUnlistedTimezone(draft.fingerprint_timezone) && (
              <option value={draft.fingerprint_timezone}>{draft.fingerprint_timezone}</option>
            )}
          </select>
          {timezoneWarning && (
            <p className="field-warning">
              <AlertTriangle size={13} />
              <span>
                The proxy exits in {timezoneWarning.proxyLabel} ({timezoneWarning.expected}).
                Sites compare this against the IP they see.
              </span>
            </p>
          )}
        </Field>
        <Field label="Geolocation" icon={<MapPin size={14} />}>
          <select
            value={draft.fingerprint_geolocation}
            onChange={(event) => set({fingerprint_geolocation: event.target.value})}
          >
            <option>Ask</option>
            <option>Block</option>
            <option>Auto from proxy</option>
            <option>Custom</option>
          </select>
        </Field>
      </FormGroup>

      <FormGroup
        title="Hardware"
        hint="The machine the browser claims to run on. Picked as whole real devices rather than mixed freely."
      >
        {isMobile ? (
          <Field label="Device model" icon={<Smartphone size={14} />} wide>
            {/* GPU/CPU/screen are picked together as one real device instead of
                mixed freely -- prevents e.g. an Android profile ending up with a
                desktop NVIDIA GPU string, which is what a real Android Chrome
                build could never actually report. */}
            <select
              value={draft.fingerprint_cpu_model}
              onChange={(event) => {
                const device = mobileDevicePatternsFor(draft.fingerprint_os)
                    .find((item) => item.fingerprint_cpu_model === event.target.value);
                if (device) {
                  const {label: _label, ...pattern} = device;
                  set(pattern);
                }
              }}
            >
              <option value="">Auto</option>
              {mobileDevicePatternsFor(draft.fingerprint_os).map((item) => (
                <option value={item.fingerprint_cpu_model} key={item.fingerprint_cpu_model}>
                  {item.label} · {item.fingerprint_screen} · {item.fingerprint_memory_gb} GB
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="GPU" icon={<Monitor size={14} />}>
              <select
                value={draft.fingerprint_webgl_renderer}
                onChange={(event) => {
                  const pattern = realisticWindowsFingerprintPatterns.find((item) =>
                    item.fingerprint_webgl_renderer === event.target.value);
                  if (pattern) {
                    set(pattern);
                  }
                }}
              >
                <option value="">Auto</option>
                {gpuPresets.map((item) => (
                  <option value={item.renderer} key={item.renderer}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="CPU" icon={<Cpu size={14} />}>
              <select
                value={draft.fingerprint_cpu_model}
                onChange={(event) => {
                  const preset = cpuPresets.find((item) => item.model === event.target.value);
                  set({
                    fingerprint_cpu_model: preset?.model || '',
                    fingerprint_cpu_cores: preset?.cores || draft.fingerprint_cpu_cores,
                  });
                }}
              >
                <option value="">Auto</option>
                {cpuPresets.map((item) => (
                  <option value={item.model} key={item.model}>{item.model} ({item.cores} threads)</option>
                ))}
              </select>
            </Field>
            <Field label="Screen" icon={<Monitor size={14} />}>
              <input
                type="text"
                list="screen-presets"
                value={draft.fingerprint_screen}
                onChange={(event) => set({fingerprint_screen: event.target.value})}
              />
            </Field>
          </>
        )}
        <Field label="Memory" icon={<Gauge size={14} />}>
          <select
            value={draft.fingerprint_memory_gb}
            onChange={(event) => set({fingerprint_memory_gb: event.target.value})}
          >
            {memoryPresets.map((item) => <option value={item} key={item}>{item} GB</option>)}
          </select>
        </Field>
        <Field label="Media devices" icon={<Video size={14} />} wide={isMobile}>
          <select
            value={draft.fingerprint_media_devices}
            onChange={(event) => set({fingerprint_media_devices: event.target.value})}
          >
            {mediaDevicePresets.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </Field>
      </FormGroup>

      <FormGroup
        title="Privacy & noise"
        hint="What the browser does to the APIs a site would otherwise use to fingerprint it. Noise perturbs the reading per profile; Block refuses it outright, which is itself distinctive."
      >
        <Field label="WebRTC" icon={<ShieldCheck size={14} />}>
          <select
            value={draft.fingerprint_webrtc}
            onChange={(event) => set({fingerprint_webrtc: event.target.value})}
          >
            {webRtcModes.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="WebGPU" icon={<ShieldCheck size={14} />}>
          <select
            value={draft.fingerprint_webgpu}
            onChange={(event) => set({fingerprint_webgpu: event.target.value})}
          >
            {webGpuModes.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <NoiseField
          label="Canvas"
          value={draft.fingerprint_canvas}
          onChange={(value) => set({fingerprint_canvas: value})}
        />
        <NoiseField
          label="WebGL"
          value={draft.fingerprint_webgl}
          onChange={(value) => set({fingerprint_webgl: value})}
        />
        <NoiseField
          label="Client rects"
          value={draft.fingerprint_client_rects}
          onChange={(value) => set({fingerprint_client_rects: value})}
        />
        <NoiseField
          label="Audio"
          value={draft.fingerprint_audio}
          onChange={(value) => set({fingerprint_audio: value})}
        />
        <label className="check-field">
          <input
            checked={draft.fingerprint_do_not_track}
            type="checkbox"
            onChange={(event) => set({fingerprint_do_not_track: event.target.checked})}
          />
          <span>Do not track</span>
        </label>
        <label className="check-field">
          <input
            checked={draft.fingerprint_rotate}
            type="checkbox"
            onChange={(event) => set({fingerprint_rotate: event.target.checked})}
          />
          <span>Rotate fingerprint on each browser launch</span>
        </label>
      </FormGroup>
    </>
  );
}

function isUnlistedTimezone(value: string) {
  if (!value || value === AUTO_FROM_PROXY) {
    return false;
  }
  return !timezoneGroups.some((group) => group.zones.some((zone) => zone.name === value));
}

// Canvas, WebGL, client rects and audio are the same three-way choice; only the
// label differs.
function NoiseField({label, value, onChange}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} icon={<ShieldCheck size={14} />}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {noiseModes.map((item) => <option key={item}>{item}</option>)}
      </select>
    </Field>
  );
}

// The <datalist>s the language and screen inputs above reference by id.
// Rendered once by whichever dialog hosts the form. Timezone used to have one
// too; it is a grouped <select> now, so an open-ended list would only let a
// typo back in.
export function FingerprintDatalists() {
  return (
    <>
      <datalist id="language-presets">
        {languagePresets.map((item) => <option value={item} key={item} />)}
      </datalist>
      <datalist id="screen-presets">
        {screenPresets.map((item) => <option value={item} key={item} />)}
      </datalist>
    </>
  );
}
