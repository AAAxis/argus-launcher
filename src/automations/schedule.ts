// The schedule document stored in automations.schedule (jsonb), and the pure
// arithmetic the scheduler ticks on. No presets-to-cron translation anywhere:
// the three kinds below are the whole language, chosen over cron strings so
// the modal, the card badge and an agent authoring over MCP all read and write
// the same small shape.
//
// Semantics the scheduler (src/hooks/useAutomationScheduler.ts) relies on:
// nextDueAt is exclusive of `after` -- it returns the first slot strictly
// later -- so a caller that passes its watermark (the last slot it fired or
// skipped) never fires the same slot twice.

export type ScheduleKind = 'interval' | 'daily' | 'weekly';

export type AutomationSchedule = {
  enabled: boolean;
  kind: ScheduleKind;
  // interval: minutes between runs, 5..1440.
  everyMinutes?: number;
  // daily/weekly: local wall-clock time, 'HH:MM'.
  at?: string;
  // weekly: days of week, 0 = Sunday .. 6 = Saturday, at least one.
  days?: number[];
  // Which profiles the automation runs on, at least one. Deleted profiles are
  // filtered at fire time, not here.
  profileIds: string[];
};

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 1440;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Human-readable problems, empty when the document is sound. Addressed to
// whoever wrote the document -- the modal shows them inline, the MCP update
// handler returns them as a 400 sentence.
export function validateSchedule(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['schedule must be an object'];
  }
  const problems: string[] = [];
  const schedule = value as Partial<AutomationSchedule>;
  if (typeof schedule.enabled !== 'boolean') {
    problems.push('schedule.enabled must be true or false');
  }
  if (schedule.kind !== 'interval' && schedule.kind !== 'daily' && schedule.kind !== 'weekly') {
    problems.push('schedule.kind must be interval, daily or weekly');
    return problems;
  }
  if (schedule.kind === 'interval') {
    const minutes = schedule.everyMinutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) ||
        minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
      problems.push('schedule.everyMinutes must be a whole number between ' +
        `${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`);
    }
  } else {
    if (typeof schedule.at !== 'string' || !TIME_PATTERN.test(schedule.at)) {
      problems.push('schedule.at must be a time like 09:30');
    }
  }
  if (schedule.kind === 'weekly') {
    const days = schedule.days;
    if (!Array.isArray(days) || days.length === 0 ||
        days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      problems.push('schedule.days must list at least one day, 0 (Sunday) through 6 (Saturday)');
    }
  }
  if (!Array.isArray(schedule.profileIds) || schedule.profileIds.length === 0 ||
      schedule.profileIds.some((id) => typeof id !== 'string' || id === '')) {
    problems.push('schedule.profileIds must name at least one profile');
  }
  return problems;
}

// What the mapper runs on every row read. Null for anything that does not
// validate: the only writers validate first, so an invalid document means the
// column was edited by hand, and a scheduler must not tick on a guess.
export function normalizeSchedule(value: unknown): AutomationSchedule | null {
  return validateSchedule(value).length === 0 ? value as AutomationSchedule : null;
}

// The first due moment strictly after `after`, in local time, or null when the
// schedule is disabled. Interval schedules anchor on `after` itself (the
// caller's watermark), calendar schedules on the wall clock.
export function nextDueAt(schedule: AutomationSchedule, after: Date): Date | null {
  if (!schedule.enabled) {
    return null;
  }
  if (schedule.kind === 'interval') {
    return new Date(after.getTime() + (schedule.everyMinutes || 0) * 60_000);
  }
  const [hours, minutes] = (schedule.at || '00:00').split(':').map(Number);
  const candidate = new Date(after);
  candidate.setHours(hours, minutes, 0, 0);
  if (candidate <= after) {
    candidate.setDate(candidate.getDate() + 1);
  }
  if (schedule.kind === 'daily') {
    return candidate;
  }
  const days = schedule.days || [];
  for (let i = 0; i < 7; i++) {
    if (days.includes(candidate.getDay())) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The card badge and the MCP list summary. "Every 30 min · 2 profiles",
// "Daily 09:00", "Mon/Wed/Fri 18:30 · 3 profiles".
export function describeSchedule(schedule: AutomationSchedule): string {
  let when: string;
  if (schedule.kind === 'interval') {
    const minutes = schedule.everyMinutes || 0;
    when = minutes % 60 === 0 && minutes >= 60 ?
      `Every ${minutes / 60} h` : `Every ${minutes} min`;
  } else if (schedule.kind === 'daily') {
    when = `Daily ${schedule.at}`;
  } else {
    const days = [...(schedule.days || [])].sort((a, b) => a - b)
        .map((day) => DAY_NAMES[day]).join('/');
    when = `${days} ${schedule.at}`;
  }
  const profiles = schedule.profileIds.length;
  return profiles > 1 ? `${when} · ${profiles} profiles` : when;
}
