// Secret redaction, tested against the real module the runner calls
// (electron/automation/redact.cjs, typed by its hand-written .d.cts) rather
// than a copy -- nothing compiles electron/, but vitest can import it directly.
// The same arrangement notifyOnFinish.test.ts uses.
import {describe, expect, it} from 'vitest';
import {MASK, redactSecrets} from '../../electron/automation/redact.cjs';
import {secretVarNames} from './parameters';
import type {AutomationParam} from './parameters';

const PARAMS: AutomationParam[] = [
  {name: 'city_name', kind: 'text'},
  {name: 'api_key', kind: 'secret'},
];

describe('secretVarNames', () => {
  it('collects only the secret kinds', () => {
    expect(secretVarNames(PARAMS)).toEqual(['api_key']);
  });

  it('collects across the whole call tree, and does not repeat one', () => {
    expect(secretVarNames(
        PARAMS,
        [{name: 'token', kind: 'secret'}],
        [{name: 'api_key', kind: 'secret'}],
    ).sort()).toEqual(['api_key', 'token']);
  });

  it('survives an automation with no declarations', () => {
    expect(secretVarNames(undefined, [])).toEqual([]);
  });
});

describe('redactSecrets', () => {
  it('masks the named keys and leaves the rest', () => {
    expect(redactSecrets(
        {city_name: 'Dortmund', api_key: 'sk-live-1234', rooms: 2},
        secretVarNames(PARAMS),
    )).toEqual({city_name: 'Dortmund', api_key: MASK, rooms: 2});
  });

  it('returns the bag untouched when nothing is secret', () => {
    const vars = {city_name: 'Dortmund'};
    expect(redactSecrets(vars, [])).toBe(vars);
    expect(redactSecrets(vars, undefined)).toBe(vars);
  });

  it('does not mutate the bag it was given -- the run still interpolates it', () => {
    const vars = {api_key: 'sk-live-1234'};
    redactSecrets(vars, ['api_key']);
    expect(vars.api_key).toBe('sk-live-1234');
  });

  it('masks a key that is present but empty, rather than skipping it', () => {
    expect(redactSecrets({api_key: ''}, ['api_key'])).toEqual({api_key: MASK});
  });

  it('ignores a name the bag does not hold', () => {
    expect(redactSecrets({city_name: 'Essen'}, ['api_key'])).toEqual({city_name: 'Essen'});
  });
});
