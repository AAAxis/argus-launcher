// The profile's platform, as six cards rather than a dropdown buried two
// dialogs deep.
//
// This is the same radiogroup-of-previews pattern as the theme cards in
// settings/sections/AppearanceSection.tsx -- the app's existing answer to "pick
// one of N visual options". Choosing here goes through withFingerprintOs, so a
// platform change still re-rolls a coherent GPU / CPU / screen / media-devices
// pattern instead of leaving an Android profile claiming an NVIDIA desktop GPU.
import {Check} from 'lucide-react';
import {PlatformIcon} from './icons';
import {osPresets} from '../../lib/fingerprintPresets';

// Android and iOS are only half-implemented downstream and the picker says so
// rather than letting the user find out from a detection site.
//
// argus_ua.cc's preset table has windows/macos/linux only; ArgusUserAgentFor()
// returns nullptr for android/ios, and argus_manager.cc then falls back to a
// UA-string-only override. So a mobile profile ships an Android or iOS user
// agent while its Client Hints still report a desktop platform, desktop form
// factor and Sec-CH-UA-Mobile: ?0 -- a mismatch any site comparing the two can
// see. The fingerprint generator pool falls back to macOS for both as well.
const MOBILE_CAVEAT = 'User agent only — Client Hints still report a desktop platform. ' +
  'Use a desktop preset on sites that compare the two.';

export function PlatformPicker({value, onChange, label = 'Platform'}: {
  value: string;
  onChange: (os: string) => void;
  label?: string;
}) {
  const isMobile = value === 'Android' || value === 'iOS';

  return (
    <>
      <div className="platform-choices" role="radiogroup" aria-label={label}>
        {osPresets.map((os) => {
          const active = os === value;
          return (
            <button
              aria-checked={active}
              className={active ? 'platform-choice active' : 'platform-choice'}
              key={os}
              onClick={() => onChange(os)}
              role="radio"
              type="button"
            >
              <PlatformIcon os={os} size={20} />
              <span className="platform-choice-label">{os}</span>
              {active && <Check className="platform-choice-check" size={13} strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
      {isMobile && <p className="field-hint">{MOBILE_CAVEAT}</p>}
    </>
  );
}
