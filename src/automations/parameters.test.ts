import {describe, expect, it} from 'vitest';
import {
  MAX_PARAMETERS, coerceParamValue, describeMissingParams, hasValue,
  missingRequired, normalizeParams, paramDefaults, paramSummary, resolveRunVars,
  validateParams,
} from './parameters';
import type {AutomationParam} from './parameters';

function param(over: Partial<AutomationParam> = {}): AutomationParam {
  return {name: 'city_name', kind: 'text', ...over};
}

describe('validateParams', () => {
  it('accepts every kind', () => {
    expect(validateParams([
      {name: 'a', kind: 'text'},
      {name: 'b', kind: 'textarea'},
      {name: 'c', kind: 'number'},
      {name: 'd', kind: 'boolean'},
      {name: 'e', kind: 'select', options: ['one', 'two']},
      {name: 'f', kind: 'secret'},
      {name: 'g', kind: 'list'},
    ])).toEqual([]);
  });

  it('refuses anything that is not a list', () => {
    expect(validateParams({city_name: 'Dortmund'})).toEqual(['parameters must be a list']);
    expect(validateParams(null)).toEqual(['parameters must be a list']);
  });

  it('holds names to the pattern setVar.name uses', () => {
    expect(validateParams([{name: 'city name', kind: 'text'}])[0])
        .toContain('must start with a letter or underscore');
    expect(validateParams([{name: '2rooms', kind: 'text'}])).toHaveLength(1);
    expect(validateParams([{name: '_city2', kind: 'text'}])).toEqual([]);
  });

  it('catches a name declared twice', () => {
    expect(validateParams([param(), param()])[0]).toContain('is declared twice');
  });

  it('needs at least one choice on a select', () => {
    expect(validateParams([{name: 'a', kind: 'select'}])[0])
        .toContain('must list at least one choice');
    expect(validateParams([{name: 'a', kind: 'select', options: ['', ' ']}]))
        .toHaveLength(1);
  });

  it('refuses required on a yes/no, which is always answered', () => {
    expect(validateParams([{name: 'a', kind: 'boolean', required: true}])[0])
        .toContain('remove required');
  });

  it('caps the list', () => {
    const many = Array.from({length: MAX_PARAMETERS + 1},
        (_, i) => ({name: `p${i}`, kind: 'text' as const}));
    expect(validateParams(many)).toEqual([`parameters may declare at most ${MAX_PARAMETERS}`]);
  });
});

describe('normalizeParams', () => {
  it('keeps a sound list and drops a broken one', () => {
    expect(normalizeParams([param()])).toEqual([param()]);
    expect(normalizeParams([{name: 'city name', kind: 'text'}])).toEqual([]);
    expect(normalizeParams('nonsense')).toEqual([]);
  });
});

describe('hasValue', () => {
  it('treats blank strings and empty lists as unset', () => {
    expect(hasValue(param(), '')).toBe(false);
    expect(hasValue(param(), '   ')).toBe(false);
    expect(hasValue(param(), undefined)).toBe(false);
    expect(hasValue(param({kind: 'list'}), [])).toBe(false);
    expect(hasValue(param(), 'Dortmund')).toBe(true);
  });

  it('treats false as an answer on a yes/no', () => {
    expect(hasValue(param({kind: 'boolean'}), false)).toBe(true);
    expect(hasValue(param({kind: 'boolean'}), undefined)).toBe(false);
  });

  it('treats 0 as a value on a number', () => {
    expect(hasValue(param({kind: 'number'}), 0)).toBe(true);
  });
});

describe('coerceParamValue', () => {
  it('parses a number, and passes junk through unchanged', () => {
    expect(coerceParamValue(param({kind: 'number'}), '2')).toBe(2);
    expect(coerceParamValue(param({kind: 'number'}), 3)).toBe(3);
    // Not NaN: "?rooms=lots" fails visibly, "?rooms=NaN" does not.
    expect(coerceParamValue(param({kind: 'number'}), 'lots')).toBe('lots');
  });

  it('reads the checkbox strings a draft holds', () => {
    expect(coerceParamValue(param({kind: 'boolean'}), 'true')).toBe(true);
    expect(coerceParamValue(param({kind: 'boolean'}), 'false')).toBe(false);
    expect(coerceParamValue(param({kind: 'boolean'}), '')).toBe(false);
    expect(coerceParamValue(param({kind: 'boolean'}), true)).toBe(true);
  });

  it('turns lines into a real array, so loop.items can take it', () => {
    expect(coerceParamValue(param({kind: 'list'}), 'Dortmund\n Essen \n\nBochum'))
        .toEqual(['Dortmund', 'Essen', 'Bochum']);
    expect(coerceParamValue(param({kind: 'list'}), ['a', ' b '])).toEqual(['a', 'b']);
  });

  it('leaves text alone', () => {
    expect(coerceParamValue(param(), 'Dortmund')).toBe('Dortmund');
    expect(coerceParamValue(param({kind: 'secret'}), 'hunter2')).toBe('hunter2');
  });
});

describe('paramDefaults', () => {
  it('takes only the parameters that declare one', () => {
    expect(paramDefaults([
      param({name: 'city_name', default: 'Dortmund'}),
      param({name: 'rooms', kind: 'number'}),
      param({name: 'note', default: '   '}),
    ])).toEqual({city_name: 'Dortmund'});
  });
});

describe('resolveRunVars', () => {
  const parameters = [
    param({name: 'city_name', required: true, default: 'Dortmund'}),
    param({name: 'rooms', kind: 'number', default: '2'}),
  ];

  it('coerces the defaults when nothing else is supplied', () => {
    expect(resolveRunVars({parameters})).toEqual({city_name: 'Dortmund', rooms: 2});
  });

  it('lets a profile beat the default', () => {
    expect(resolveRunVars({parameters, profileValues: {city_name: 'Essen'}}))
        .toEqual({city_name: 'Essen', rooms: 2});
  });

  it('lets an override beat the profile', () => {
    expect(resolveRunVars({
      parameters,
      profileValues: {city_name: 'Essen'},
      overrides: {city_name: 'Bochum', rooms: 3},
    })).toEqual({city_name: 'Bochum', rooms: 3});
  });

  it('falls back through a blank profile value rather than blanking the default', () => {
    expect(resolveRunVars({parameters, profileValues: {city_name: '  '}}))
        .toEqual({city_name: 'Dortmund', rooms: 2});
  });

  it('drops a profile value whose parameter no longer exists', () => {
    expect(resolveRunVars({parameters, profileValues: {gone: 'stale'}}))
        .toEqual({city_name: 'Dortmund', rooms: 2});
  });

  // The contract POST /v1/automations/run had before parameters existed: an
  // agent may seed any variable it likes, declared or not.
  it('passes an undeclared override through untouched', () => {
    expect(resolveRunVars({parameters: [], overrides: {rows: [{a: 1}], n: 7}}))
        .toEqual({rows: [{a: 1}], n: 7});
    expect(resolveRunVars({parameters, overrides: {seed: 'raw'}}))
        .toEqual({city_name: 'Dortmund', rooms: 2, seed: 'raw'});
  });

  it('lets a blank override fall back to the profile', () => {
    expect(resolveRunVars({
      parameters,
      profileValues: {city_name: 'Essen'},
      overrides: {city_name: ''},
    }).city_name).toBe('Essen');
  });

  it('takes a callee default the caller never declared', () => {
    expect(resolveRunVars({
      parameters,
      calleeParameters: [[param({name: 'group_url', default: 'https://example.com'})]],
    })).toEqual({
      city_name: 'Dortmund', rooms: 2, group_url: 'https://example.com',
    });
  });

  it('prefers the caller when both declare the same name', () => {
    expect(resolveRunVars({
      parameters,
      calleeParameters: [[param({name: 'city_name', default: 'Cologne'})]],
    }).city_name).toBe('Dortmund');
  });

  it('coerces a value supplied for a callee-only parameter', () => {
    expect(resolveRunVars({
      parameters: [],
      calleeParameters: [[param({name: 'rooms', kind: 'number'})]],
      overrides: {rooms: '4'},
    })).toEqual({rooms: 4});
  });
});

describe('missingRequired / describeMissingParams', () => {
  const parameters = [
    param({name: 'city_name', required: true}),
    param({name: 'street', required: true}),
    param({name: 'rooms', kind: 'number'}),
  ];

  it('is satisfied by any resolved value, default included', () => {
    expect(missingRequired([param({name: 'city_name', required: true})],
        {city_name: 'Dortmund'})).toEqual([]);
  });

  it('names one missing parameter', () => {
    expect(describeMissingParams(parameters, {street: 'Hauptstr'}))
        .toBe('needs a value for city_name');
  });

  it('joins several, and prefers the label', () => {
    expect(describeMissingParams([
      param({name: 'city_name', label: 'City', required: true}),
      param({name: 'street', label: 'Street', required: true}),
    ], {})).toBe('needs values for City and Street');
  });

  it('is null when nothing is missing', () => {
    expect(describeMissingParams(parameters, {city_name: 'Essen', street: 'A'})).toBeNull();
    expect(describeMissingParams([], {})).toBeNull();
  });
});

describe('paramSummary', () => {
  it('reads as the collapsed row', () => {
    expect(paramSummary(param({required: true}))).toBe('city_name · text · required');
    expect(paramSummary(param({name: 'rooms', kind: 'number'}))).toBe('rooms · number');
  });
});
