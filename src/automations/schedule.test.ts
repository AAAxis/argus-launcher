import {describe, expect, it} from 'vitest';
import {
  describeSchedule, nextDueAt, normalizeSchedule, validateSchedule,
} from './schedule';
import type {AutomationSchedule} from './schedule';

function interval(everyMinutes: number, profileIds = ['p1']): AutomationSchedule {
  return {enabled: true, kind: 'interval', everyMinutes, profileIds};
}

// Local wall-clock constructor, matching the scheduler's arithmetic.
function at(iso: string): Date {
  return new Date(iso);
}

describe('validateSchedule', () => {
  it('accepts the three kinds', () => {
    expect(validateSchedule(interval(30))).toEqual([]);
    expect(validateSchedule(
        {enabled: true, kind: 'daily', at: '09:30', profileIds: ['p1']})).toEqual([]);
    expect(validateSchedule(
        {enabled: true, kind: 'weekly', at: '18:00', days: [1, 3], profileIds: ['p1']}))
        .toEqual([]);
  });

  it('refuses a non-object', () => {
    expect(validateSchedule('daily')).toEqual(['schedule must be an object']);
    expect(validateSchedule(null)).toEqual(['schedule must be an object']);
    expect(validateSchedule([1])).toEqual(['schedule must be an object']);
  });

  it('refuses an unknown kind before checking anything else', () => {
    const problems = validateSchedule({enabled: true, kind: 'hourly', profileIds: ['p1']});
    expect(problems.some((p) => p.includes('interval, daily or weekly'))).toBe(true);
  });

  it('bounds the interval', () => {
    expect(validateSchedule(interval(4)).length).toBe(1);
    expect(validateSchedule(interval(1441)).length).toBe(1);
    expect(validateSchedule(interval(5))).toEqual([]);
    expect(validateSchedule(interval(1440))).toEqual([]);
  });

  it('requires a well-formed time for daily and weekly', () => {
    expect(validateSchedule(
        {enabled: true, kind: 'daily', at: '25:00', profileIds: ['p1']}).length).toBe(1);
    expect(validateSchedule(
        {enabled: true, kind: 'daily', at: '9:00', profileIds: ['p1']}).length).toBe(1);
  });

  it('requires at least one weekday and one profile', () => {
    expect(validateSchedule(
        {enabled: true, kind: 'weekly', at: '09:00', days: [], profileIds: ['p1']})
        .length).toBe(1);
    expect(validateSchedule(
        {enabled: true, kind: 'weekly', at: '09:00', days: [7], profileIds: ['p1']})
        .length).toBe(1);
    expect(validateSchedule(
        {enabled: true, kind: 'daily', at: '09:00', profileIds: []}).length).toBe(1);
  });
});

describe('normalizeSchedule', () => {
  it('returns the document when sound, null otherwise', () => {
    const sound = interval(30);
    expect(normalizeSchedule(sound)).toEqual(sound);
    expect(normalizeSchedule({kind: 'interval'})).toBeNull();
    expect(normalizeSchedule(undefined)).toBeNull();
  });
});

describe('nextDueAt', () => {
  it('is null when disabled', () => {
    expect(nextDueAt({...interval(30), enabled: false}, new Date())).toBeNull();
  });

  it('anchors an interval on the watermark', () => {
    const due = nextDueAt(interval(30), at('2026-08-09T10:00:00'));
    expect(due?.toISOString()).toBe(at('2026-08-09T10:30:00').toISOString());
  });

  it('finds today\'s daily slot when it is still ahead', () => {
    const schedule: AutomationSchedule =
      {enabled: true, kind: 'daily', at: '15:00', profileIds: ['p1']};
    const due = nextDueAt(schedule, at('2026-08-09T10:00:00'));
    expect(due?.getHours()).toBe(15);
    expect(due?.getDate()).toBe(9);
  });

  it('rolls a passed daily slot to tomorrow', () => {
    const schedule: AutomationSchedule =
      {enabled: true, kind: 'daily', at: '09:00', profileIds: ['p1']};
    const due = nextDueAt(schedule, at('2026-08-09T10:00:00'));
    expect(due?.getDate()).toBe(10);
    expect(due?.getHours()).toBe(9);
  });

  it('is exclusive of the moment itself — the same slot never fires twice', () => {
    const schedule: AutomationSchedule =
      {enabled: true, kind: 'daily', at: '09:00', profileIds: ['p1']};
    const due = nextDueAt(schedule, at('2026-08-09T09:00:00'));
    expect(due?.getDate()).toBe(10);
  });

  it('finds the next listed weekday', () => {
    // 2026-08-09 is a Sunday.
    const schedule: AutomationSchedule =
      {enabled: true, kind: 'weekly', at: '09:00', days: [3], profileIds: ['p1']};
    const due = nextDueAt(schedule, at('2026-08-09T10:00:00'));
    expect(due?.getDay()).toBe(3);
    expect(due?.getDate()).toBe(12);
  });

  it('wraps a weekly schedule into next week', () => {
    // Sunday 10:00, slot is Sundays 09:00 -> next Sunday.
    const schedule: AutomationSchedule =
      {enabled: true, kind: 'weekly', at: '09:00', days: [0], profileIds: ['p1']};
    const due = nextDueAt(schedule, at('2026-08-09T10:00:00'));
    expect(due?.getDay()).toBe(0);
    expect(due?.getDate()).toBe(16);
  });
});

describe('describeSchedule', () => {
  it('reads minutes, whole hours, days and profile counts', () => {
    expect(describeSchedule(interval(30))).toBe('Every 30 min');
    expect(describeSchedule(interval(120))).toBe('Every 2 h');
    expect(describeSchedule(interval(30, ['a', 'b']))).toBe('Every 30 min · 2 profiles');
    expect(describeSchedule(
        {enabled: true, kind: 'daily', at: '09:00', profileIds: ['a']})).toBe('Daily 09:00');
    expect(describeSchedule(
        {enabled: true, kind: 'weekly', at: '18:30', days: [3, 1], profileIds: ['a']}))
        .toBe('Mon/Wed 18:30');
  });
});
