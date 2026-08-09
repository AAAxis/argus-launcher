import {describe, expect, it} from 'vitest';
import {collectCallees, resolveCallTree} from './callGraph';
import type {AutomationStep} from './types';

function call(automationId: string): AutomationStep {
  return {id: `call-${automationId}`, type: 'callAutomation', automationId};
}

function flow(id: string, steps: AutomationStep[]) {
  return {id, name: id.toUpperCase(), steps};
}

describe('collectCallees', () => {
  it('finds calls at the top level and inside branches', () => {
    const steps: AutomationStep[] = [
      call('x'),
      {
        id: 'if1', type: 'if', condition: {left: '{{vars.a}}', op: 'exists'},
        then: [call('y')],
        else: [{
          id: 'loop1', type: 'loop', mode: 'times', times: 2,
          body: [call('z'), call('x')],
        }],
      },
    ];
    expect(collectCallees(steps).sort()).toEqual(['x', 'y', 'z']);
  });

  it('returns nothing for steps without calls', () => {
    expect(collectCallees([{id: 'g', type: 'goto', url: 'https://a.com'}])).toEqual([]);
  });
});

describe('resolveCallTree', () => {
  it('resolves a linear chain', () => {
    const c = flow('c', [{id: 'g', type: 'goto', url: 'https://a.com'}]);
    const b = flow('b', [call('c')]);
    const a = flow('a', [call('b')]);
    const {resolved, problems} = resolveCallTree(a, [a, b, c]);
    expect(problems).toEqual([]);
    expect(Object.keys(resolved).sort()).toEqual(['b', 'c']);
  });

  it('names an unknown callee', () => {
    const a = flow('a', [call('ghost')]);
    const {problems} = resolveCallTree(a, [a]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer exists');
    expect(problems[0]).toContain('ghost');
  });

  it('refuses a direct self-call', () => {
    const a = flow('a', [call('a')]);
    const {problems} = resolveCallTree(a, [a]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('circle');
  });

  it('refuses an indirect cycle', () => {
    const a = flow('a', [call('b')]);
    const b = flow('b', [call('a')]);
    const {problems} = resolveCallTree(a, [a, b]);
    expect(problems.some((problem) => problem.includes('circle'))).toBe(true);
  });

  it('caps call depth', () => {
    const d = flow('d', [call('e')]);
    const e = flow('e', []);
    const c = flow('c', [call('d')]);
    const b = flow('b', [call('c')]);
    const a = flow('a', [call('b')]);
    const {problems} = resolveCallTree(a, [a, b, c, d, e]);
    expect(problems.some((problem) => problem.includes('levels deep'))).toBe(true);
  });

  it('allows the diamond — two callers sharing one callee', () => {
    const d = flow('d', []);
    const b = flow('b', [call('d')]);
    const c = flow('c', [call('d')]);
    const a = flow('a', [call('b'), call('c')]);
    const {resolved, problems} = resolveCallTree(a, [a, b, c, d]);
    expect(problems).toEqual([]);
    expect(Object.keys(resolved).sort()).toEqual(['b', 'c', 'd']);
  });
});
