export function initials(value: string) {
  return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'A';
}

// Dates from Supabase are ISO strings. Rendered in the user's locale, day-first
// or month-first as their system says, because this is read, not parsed.
export function formatDate(value: string | null | undefined) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'});
}

// The sidebar account row is a single line shared with a 24px avatar and the
// settings gear, inside a 260px rail. CSS ellipsis alone is not enough: it
// clips at whatever width is left, which for a long local part is a few
// characters, and an unbreakable address can still push the gear off the row.
// Capping the string here keeps the row's geometry fixed; the full address
// stays available in the row's title.
const ACCOUNT_EMAIL_MAX = 24;

export function shortenEmail(email: string) {
  if (email.length <= ACCOUNT_EMAIL_MAX) {
    return email;
  }
  const at = email.lastIndexOf('@');
  const domain = at > 0 ? email.slice(at) : '';
  // Elide the local part and keep the domain, which is the half that tells you
  // which account you are in. If the domain alone is long enough to leave no
  // recognisable local part, truncate the address as a whole instead.
  const room = ACCOUNT_EMAIL_MAX - domain.length - 1;
  if (!domain || room < 3) {
    return `${email.slice(0, ACCOUNT_EMAIL_MAX - 1)}…`;
  }
  return `${email.slice(0, room)}…${domain}`;
}

export function escapeHtml(value: string) {
  return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

export function comparable(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Merges any number of status groups into one deduped, case-insensitive list
// while keeping first-seen order and the original casing.
export function statusList(...groups: Array<Array<string | undefined | null>>) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      const status = String(value || '').trim();
      const key = status.toLowerCase();
      if (!status || seen.has(key)) {
        continue;
      }
      seen.add(key);
      list.push(status);
    }
  }
  return list;
}

// The table form of the above: "04 Aug 2026".
//
// The tables used to slice the ISO string, which is unambiguous but reads as a
// serial number -- down a column of twenty-five the eye has to parse the month
// back out of a two-digit field every time. A short month name is scannable at
// a glance and, unlike "04/08/2026", cannot be misread as US ordering.
//
// Separate from formatDate rather than replacing it: that one is prose in the
// settings panels ("Renews 4 August 2026"), where the full month reads better
// and there is room for it. This one is for a column.
//
// Fixed to en-GB rather than the user's locale, which is what pins the day-
// first order and the two-digit day: a column of dates should line up, and a
// screenshot passed around the team should mean the same thing to everyone.
export function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'});
}
