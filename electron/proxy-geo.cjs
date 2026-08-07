// Where a proxy is, and what a profile behind it should therefore report.
//
// Split out of main.cjs so it can be tested: main.cjs requires electron and runs
// to thousands of lines, so nothing in it is reachable from vitest. These four
// functions are pure and decide what every launched profile tells the sites it
// visits, which is exactly the kind of logic that should not be untestable.
// Same arrangement as built-in-extensions.cjs.
//
// The renderer answers the same question from src/lib/proxyGeo.ts, for the
// profile editor's warning. Both read country-defaults.json, so the table is
// shared even though the two resolvers are not: this one runs at launch and
// prefers a freshly measured location, the renderer's runs against stored rows.

// Mirrors chrome/browser/argus/argus_fingerprint.cc's kDefaults table so a
// proxy's country resolves to the same timezone/language/geo the in-app
// fingerprint system would pick. Keyed by lowercase ISO-3166-1 alpha-2 code.
//
// Country granularity is the floor, not the target. It is only consulted when a
// proxy has no per-IP location of its own -- `us` here means New York for a
// Denver proxy, which is exactly the mismatch the per-IP tier exists to avoid.
const COUNTRY_DEFAULTS = require('./country-defaults.json');

const AUTO_FROM_PROXY = 'Auto from proxy';

// Whether ICU recognises `tz` as an IANA zone. Geolocation providers are a third
// party whose answer is written straight into `export TZ=` in the launch wrapper,
// so an unrecognised or malformed name must never reach it.
function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: tz});
    return true;
  } catch {
    return false;
  }
}

// Number('') and Number(null) are both 0, and 0,0 is a real coordinate in the
// Atlantic -- so a provider that answers with a blank field would otherwise
// place the profile at Null Island rather than nowhere. Reject anything that is
// not actually a number written out.
function numberOrUndefined(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Pulls the location fields out of one geolocation provider's response.
//
// The three endpoints checkProxyEndpoint queries disagree on nearly every
// spelling: ip-api.com says `lat`/`lon`/`regionName`, ipapi.co says
// `latitude`/`longitude`/`region`, and ipinfo.io packs both coordinates into a
// single `loc` string. Reading only one dialect is how the fields came to be
// dropped in the first place.
function parseProxyGeo(data) {
  const timezone = data.timezone || data.time_zone || undefined;
  let latitude = numberOrUndefined(data.latitude ?? data.lat);
  let longitude = numberOrUndefined(data.longitude ?? data.lon);
  if ((latitude === undefined || longitude === undefined) && typeof data.loc === 'string') {
    const [lat, lon] = data.loc.split(',');
    latitude = numberOrUndefined(lat);
    longitude = numberOrUndefined(lon);
  }
  return {
    timezone: isValidTimeZone(timezone) ? timezone : undefined,
    city: data.city || undefined,
    region: data.region || data.regionName || data.region_name || undefined,
    latitude,
    longitude,
  };
}

// Resolves a profile's effective timezone, most specific source first: an
// explicit non-"Auto" zone the user picked, then the zone the proxy's own egress
// IP geolocates to, then the country default.
//
// `geo` is the live checkProxy result when the caller has just run one, and it
// wins over the stored columns -- those can be stale, or cleared outright by a
// credential edit, and a timezone measured seconds ago is the whole point.
//
// Returning null means "nothing here knows", and the launch path treats that as
// a blocker rather than launching with no TZ at all: a profile that skips the
// export reports the *host* machine's zone, which is a far louder contradiction
// than any wrong-but-plausible zone in the proxy's own country.
function resolveTimezone(fingerprintTimezone, proxy, geo) {
  if (fingerprintTimezone && fingerprintTimezone !== AUTO_FROM_PROXY) {
    return fingerprintTimezone;
  }
  const measured = geo?.timezone || proxy?.timezone;
  if (isValidTimeZone(measured)) {
    return measured;
  }
  const code = (geo?.countryCode || proxy?.country_code || '').toLowerCase();
  return COUNTRY_DEFAULTS[code]?.timezone || null;
}

// Language stays country-derived -- unlike timezone it does not vary by city, so
// country is the right granularity here. It still prefers the live check's
// country over the stored one, for the same staleness reason.
function resolveLanguage(fingerprintLanguage, proxy, geo) {
  if (fingerprintLanguage && fingerprintLanguage !== AUTO_FROM_PROXY) {
    return fingerprintLanguage;
  }
  const code = (geo?.countryCode || proxy?.country_code || '').toLowerCase();
  return COUNTRY_DEFAULTS[code]?.language || null;
}

module.exports = {
  AUTO_FROM_PROXY,
  COUNTRY_DEFAULTS,
  isValidTimeZone,
  parseProxyGeo,
  resolveLanguage,
  resolveTimezone,
};
