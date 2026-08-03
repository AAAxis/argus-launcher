// The fingerprint editor's form. Split out of the profile dialog because it is
// the one part of it that is genuinely reusable -- anything that edits a
// browser identity needs exactly these fields.
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
  timezonePresets,
  webGpuModes,
  webRtcModes,
} from '../../lib/fingerprintPresets';
import {Field} from '../ui/Field';
import {PlatformPicker} from '../ui/PlatformPicker';
import {withFingerprintOs} from '../../drafts';
import type {ProfileDraft} from '../../drafts';

export function FingerprintFields({draft, onChange, onRotate}: {
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  // Shown as an inline "Rotate fingerprint" button above the fields when the
  // host dialog wants one there as well as in its footer.
  onRotate?: () => void;
}) {
  const set = (patch: Partial<ProfileDraft>) => onChange({...draft, ...patch});
  const isMobile = draft.fingerprint_os === 'Android' || draft.fingerprint_os === 'iOS';

  return (
    <section className="form-section wide fingerprint-section">
      <div>
        <h3>Fingerprint</h3>
        <p>Profile-level browser identity settings stored with cloud data.</p>
        {onRotate && (
          <button className="ghost" type="button" onClick={onRotate}>
            Rotate fingerprint
          </button>
        )}
      </div>

      {/* The same control the profile dialog now shows on its main form, not a
        * second one: both write fingerprint_os through withFingerprintOs, so
        * there is one place a platform change re-rolls the hardware pattern. */}
      <Field label="Operating system" wide group>
        <PlatformPicker
          label="Operating system"
          value={draft.fingerprint_os}
          onChange={(os) => onChange(withFingerprintOs(draft, os))}
        />
      </Field>
      <label className="field">
        <span>Browser version</span>
        <select
          value={draft.fingerprint_browser_version}
          onChange={(event) => set({fingerprint_browser_version: event.target.value})}
        >
          {browserVersionPresets.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="field wide">
        <span>User agent</span>
        <input
          type="text"
          placeholder="Auto when empty"
          value={draft.fingerprint_user_agent}
          onChange={(event) => set({fingerprint_user_agent: event.target.value})}
        />
      </label>
      <label className="field">
        <span>Language</span>
        <input
          type="text"
          list="language-presets"
          value={draft.fingerprint_language}
          onChange={(event) => set({fingerprint_language: event.target.value})}
        />
      </label>
      <label className="field">
        <span>Timezone</span>
        <input
          type="text"
          list="timezone-presets"
          value={draft.fingerprint_timezone}
          onChange={(event) => set({fingerprint_timezone: event.target.value})}
        />
      </label>
      <label className="field">
        <span>Geolocation</span>
        <select
          value={draft.fingerprint_geolocation}
          onChange={(event) => set({fingerprint_geolocation: event.target.value})}
        >
          <option>Ask</option>
          <option>Block</option>
          <option>Auto from proxy</option>
          <option>Custom</option>
        </select>
      </label>
      <label className="field">
        <span>WebRTC</span>
        <select
          value={draft.fingerprint_webrtc}
          onChange={(event) => set({fingerprint_webrtc: event.target.value})}
        >
          {webRtcModes.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>

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
      <label className="field">
        <span>WebGPU</span>
        <select
          value={draft.fingerprint_webgpu}
          onChange={(event) => set({fingerprint_webgpu: event.target.value})}
        >
          {webGpuModes.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
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

      {isMobile ? (
        <label className="field wide">
          <span>Device model</span>
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
        </label>
      ) : (
        <>
          <label className="field">
            <span>GPU</span>
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
          </label>
          <label className="field">
            <span>Screen</span>
            <input
              type="text"
              list="screen-presets"
              value={draft.fingerprint_screen}
              onChange={(event) => set({fingerprint_screen: event.target.value})}
            />
          </label>
          <label className="field">
            <span>CPU</span>
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
          </label>
        </>
      )}

      <label className="field compact">
        <span>Memory GB</span>
        <select
          value={draft.fingerprint_memory_gb}
          onChange={(event) => set({fingerprint_memory_gb: event.target.value})}
        >
          {memoryPresets.map((item) => <option value={item} key={item}>{item} GB</option>)}
        </select>
      </label>
      <label className="field">
        <span>Media devices</span>
        <select
          value={draft.fingerprint_media_devices}
          onChange={(event) => set({fingerprint_media_devices: event.target.value})}
        >
          {mediaDevicePresets.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      <label className="check-field">
        <input
          checked={draft.fingerprint_do_not_track}
          type="checkbox"
          onChange={(event) => set({fingerprint_do_not_track: event.target.checked})}
        />
        <span>Do not track</span>
      </label>
      <label className="check-field wide">
        <input
          checked={draft.fingerprint_rotate}
          type="checkbox"
          onChange={(event) => set({fingerprint_rotate: event.target.checked})}
        />
        <span>Rotate fingerprint on each browser launch</span>
      </label>
    </section>
  );
}

// Canvas, WebGL, client rects and audio are the same three-way choice; only the
// label differs.
function NoiseField({label, value, onChange}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {noiseModes.map((item) => <option key={item}>{item}</option>)}
      </select>
    </label>
  );
}

// The <datalist>s the language, timezone and screen inputs above reference by
// id. Rendered once by whichever dialog hosts the form.
export function FingerprintDatalists() {
  return (
    <>
      <datalist id="language-presets">
        {languagePresets.map((item) => <option value={item} key={item} />)}
      </datalist>
      <datalist id="timezone-presets">
        {timezonePresets.map((item) => <option value={item} key={item} />)}
      </datalist>
      <datalist id="screen-presets">
        {screenPresets.map((item) => <option value={item} key={item} />)}
      </datalist>
    </>
  );
}
