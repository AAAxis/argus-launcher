// Every dropdown option and device-identity table the fingerprint editor
// offers. Data only -- the mapping from these choices onto what the browser
// actually applies lives in lib/fingerprint.ts, and the draft plumbing in
// drafts.ts.
import {randomChoice} from './random';
import type {ProfileDraft} from '../drafts';

// A profile's colour used to live here too, as six raw hexes. It is not a
// fingerprint preset and it is not a hex any more -- see lib/profileColors.ts.
// Order is the order the platform cards are drawn in, so it runs desktop-first
// and ends on the two mobile presets the browser only half-implements. The
// default for a new profile (Windows 11) is deliberately the first card rather
// than the fourth. Membership is all normalizeOsPreset cares about, so this is
// free to be a display order.
export const osPresets = ['Windows 11', 'Windows 10', 'macOS', 'Ubuntu', 'Android', 'iOS'];
export const browserVersionPresets = ['Auto', 'Chrome 126', 'Chrome 125', 'Chrome 124'];
export const AUTO_FROM_PROXY = 'Auto from proxy';
export const languagePresets = [AUTO_FROM_PROXY, 'en-US,en;q=0.9', 'en-GB,en;q=0.9', 'ru-RU,ru;q=0.9,en;q=0.8'];
export const timezonePresets = ['Auto from proxy', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Jerusalem'];
export const webRtcModes = ['Proxy only', 'Disabled', 'Real', 'Custom'];
export const noiseModes = ['Real', 'Noise', 'Block'];
export const webGpuModes = ['Real', 'Block'];
export const mediaDevicePresets = [
  '1 camera 1 microphone 1 speaker',
  '0 camera 1 microphone 1 speaker',
  '1 camera 1 microphone 0 speaker',
  '0 camera 0 microphone 0 speaker',
];
export const portsToProtect = '3389,5900,5800,7070,6568,5938,63333,5901,5902,5903,5950,5931,5939,6039,5944,6040,5279,2112';
export const screenPresets = ['Auto', '390x844', '393x873', '412x915', '430x932', '1920x1080', '1536x864', '1366x768', '1600x900', '1920x1200', '2560x1440', '2560x1600', '3440x1440', '3840x2160'];
export const memoryPresets = ['4', '8', '16', '32'];

export const osFingerprintDefaults: Record<string, Partial<ProfileDraft>> = {
  Android: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '393x873',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
    fingerprint_media_devices: '1 camera 1 microphone 1 speaker',
  },
  iOS: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '390x844',
    fingerprint_cpu_model: 'Apple A16 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
    fingerprint_media_devices: '1 camera 1 microphone 1 speaker',
  },
  macOS: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '1512x982',
    fingerprint_cpu_model: 'Apple M2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  Ubuntu: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-12400',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
};

export type RealisticFingerprintPattern = Pick<ProfileDraft,
  'fingerprint_os' |
  'fingerprint_browser_version' |
  'fingerprint_webgl_vendor' |
  'fingerprint_webgl_renderer' |
  'fingerprint_screen' |
  'fingerprint_cpu_model' |
  'fingerprint_cpu_cores' |
  'fingerprint_memory_gb'
>;

export const realisticWindowsFingerprintPatterns: RealisticFingerprintPattern[] = [
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-12400F',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-13400F',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 5800X',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'Intel Core i7-13700K',
    fingerprint_cpu_cores: '20',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-10400',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-11400',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 3600',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '3840x2160',
    fingerprint_cpu_model: 'Intel Core i9-12900K',
    fingerprint_cpu_cores: '24',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1200',
    fingerprint_cpu_model: 'Intel Core i7-12700H',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1600',
    fingerprint_cpu_model: 'Intel Core i7-13700H',
    fingerprint_cpu_cores: '20',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1366x768',
    fingerprint_cpu_model: 'Intel Core i5-7300HQ',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 5600X',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 5800X3D',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 7600',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 7800X3D',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 7 5700U',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1366x768',
    fingerprint_cpu_model: 'Intel Core i5-8250U',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1200',
    fingerprint_cpu_model: 'Intel Core i5-1135G7',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'Intel Core i5-12600K',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1536x864',
    fingerprint_cpu_model: 'Intel Core i5-11400H',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
];

// Real device bundles for Android/iOS -- screen/GPU/CPU/memory are picked
// together as one unit (via the "Device model" field in the fingerprint editor)
// instead of the free-mix GPU/CPU dropdowns desktop platforms use, so a profile
// can no longer end up as "Android" reporting an NVIDIA desktop GPU string. iOS
// entries all use "Apple Inc." / "Apple GPU" since every iOS browser is
// WebKit-based on real hardware, regardless of model.
export type MobileDevicePattern = RealisticFingerprintPattern & {label: string};

export const mobileDevicePatterns: MobileDevicePattern[] = [
  {
    label: 'iPhone 15 Pro Max',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '430x932',
    fingerprint_cpu_model: 'Apple A17 Pro',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'iPhone 15',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '393x852',
    fingerprint_cpu_model: 'Apple A16 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
  },
  {
    label: 'iPhone 14',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '390x844',
    fingerprint_cpu_model: 'Apple A15 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
  },
  {
    label: 'iPhone 13 mini',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '375x812',
    fingerprint_cpu_model: 'Apple A15 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '4',
  },
  {
    label: 'Samsung Galaxy S24 Ultra',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 750',
    fingerprint_screen: '412x915',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 3',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '12',
  },
  {
    label: 'Samsung Galaxy S23',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '360x780',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'Google Pixel 8 Pro',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '412x892',
    fingerprint_cpu_model: 'Google Tensor G3',
    fingerprint_cpu_cores: '9',
    fingerprint_memory_gb: '12',
  },
  {
    label: 'Google Pixel 7',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Mali-G710 MC10',
    fingerprint_screen: '412x915',
    fingerprint_cpu_model: 'Google Tensor G2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'OnePlus 11',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '412x919',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '16',
  },
];

export function mobileDevicePatternsFor(os: string): MobileDevicePattern[] {
  return mobileDevicePatterns.filter((item) => item.fingerprint_os === os);
}

export const defaultWindowsFingerprintPattern = realisticWindowsFingerprintPatterns[0];

export const gpuPresets = realisticWindowsFingerprintPatterns.map((pattern) => ({
  label: pattern.fingerprint_webgl_renderer.replace(/^ANGLE \(([^,]+), /, '').replace(/ Direct3D11.*$/, ''),
  vendor: pattern.fingerprint_webgl_vendor,
  renderer: pattern.fingerprint_webgl_renderer,
}));

export const cpuPresets = Array.from(new Map(realisticWindowsFingerprintPatterns.map((pattern) => [
  pattern.fingerprint_cpu_model,
  {
    model: pattern.fingerprint_cpu_model,
    cores: pattern.fingerprint_cpu_cores,
  },
])).values());

export function normalizeOsPreset(value?: string) {
  if (value === 'Windows') {
    return 'Windows 11';
  }
  if (value === 'Linux') {
    return 'Ubuntu';
  }
  return value && osPresets.includes(value) ? value : 'macOS';
}

export function fingerprintPatchForOs(os: string): Partial<ProfileDraft> {
  if (os.startsWith('Windows')) {
    const matchingPatterns = realisticWindowsFingerprintPatterns.filter((pattern) =>
      pattern.fingerprint_os === os);
    return {
      ...randomChoice(matchingPatterns.length ? matchingPatterns : realisticWindowsFingerprintPatterns),
      fingerprint_user_agent: '',
    };
  }
  return osFingerprintDefaults[os] || {};
}

// The knobs a rotate resets alongside the hardware pattern. Timezone, language
// and geolocation are deliberately parked back on "Auto from proxy" rather than
// randomized to an unrelated preset: that lets the launcher derive
// location-sensitive values from the assigned proxy at launch time.
const rotationDefaults: Partial<ProfileDraft> = {
  fingerprint_timezone: AUTO_FROM_PROXY,
  fingerprint_geolocation: AUTO_FROM_PROXY,
  fingerprint_language: AUTO_FROM_PROXY,
  fingerprint_webrtc: 'Proxy only',
  fingerprint_canvas: 'Noise',
  fingerprint_webgl: 'Noise',
  fingerprint_webgpu: 'Real',
  fingerprint_client_rects: 'Noise',
  fingerprint_audio: 'Noise',
  fingerprint_media_devices: mediaDevicePresets[0],
  fingerprint_do_not_track: false,
  fingerprint_user_agent: '',
};

// `os` is the profile's *current* platform selection -- rotating must pick a
// new device within that same platform (another iPhone, another Android
// phone, another Windows box), never silently switch platforms. Previously
// this always drew from realisticWindowsFingerprintPatterns regardless of
// os, so rotating on an iOS/Android profile would overwrite it with a
// random Windows/Samsung-style identity -- the actual bug behind "why does
// iOS let me pick a Samsung device".
export function randomFingerprintPatch(os: string): Partial<ProfileDraft> {
  const mobilePool = mobileDevicePatternsFor(os);
  if (mobilePool.length > 0) {
    const {label: _label, ...pattern} = randomChoice(mobilePool);
    return {...pattern, ...rotationDefaults};
  }
  return {...randomChoice(realisticWindowsFingerprintPatterns), ...rotationDefaults};
}
