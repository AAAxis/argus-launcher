// Notify-on-finish's two pure decisions, tested against the real module the
// runner calls (electron/automation/notify.cjs, typed by its hand-written
// .d.cts) rather than a copy -- nothing compiles electron/, but vitest can
// import it directly.
import {describe, expect, it} from 'vitest';
import {
  composeFinishMessage,
  composeFinishTelegram,
  shouldNotify,
} from '../../electron/automation/notify.cjs';

function record(overrides: Partial<Parameters<typeof composeFinishMessage>[0]> = {}) {
  return {
    automation_name: 'Nightly scrape',
    profile_name: 'Amazon-3',
    status: 'ok',
    duration_ms: 42000,
    failed_step_id: null,
    error: null,
    log: [],
    ...overrides,
  };
}

describe('shouldNotify', () => {
  it('fires on every finished outcome under always -- except cancelled', () => {
    expect(shouldNotify('always', 'ok')).toBe(true);
    expect(shouldNotify('always', 'partial')).toBe(true);
    expect(shouldNotify('always', 'failed')).toBe(true);
    // A cancel is the user's own action, taken while watching. There is no
    // outcome to report about a run they just ended themselves.
    expect(shouldNotify('always', 'cancelled')).toBe(false);
  });

  it('fires only on failed and partial under failure', () => {
    expect(shouldNotify('failure', 'ok')).toBe(false);
    // A partial run contained a real step failure onError:'continue' stepped
    // past. "Tell me on failure" staying silent about it would make the
    // setting a liar.
    expect(shouldNotify('failure', 'partial')).toBe(true);
    expect(shouldNotify('failure', 'failed')).toBe(true);
    expect(shouldNotify('failure', 'cancelled')).toBe(false);
  });

  it('never fires when the automation does not notify', () => {
    for (const status of ['ok', 'partial', 'failed', 'cancelled']) {
      expect(shouldNotify(null, status)).toBe(false);
      expect(shouldNotify(undefined, status)).toBe(false);
    }
  });
});

describe('composeFinishMessage', () => {
  it('reports a success with duration and profile, and no talk of failure', () => {
    const message = composeFinishMessage(record());
    expect(message.title).toBe('Nightly scrape finished');
    expect(message.body).toBe('Finished in 42s on Amazon-3.');
    expect(`${message.title} ${message.body}`.toLowerCase()).not.toContain('fail');
  });

  // The spec's hard requirement: a run that failed must produce a message
  // that says so, naming the step and its error -- a summary that only ever
  // reports success is worse than none.
  it('names the failing step and its error on a failure', () => {
    const message = composeFinishMessage(record({
      status: 'failed',
      failed_step_id: 's2',
      error: 'net::ERR_TIMED_OUT',
      log: [
        {stepId: 's1', message: 'Go to example.com'},
        {stepId: 's2', message: 'Click #login'},
      ],
    }));
    expect(message.title).toBe('Nightly scrape failed');
    expect(message.body).toBe(
        'Failed at "Click #login" in 42s on Amazon-3: net::ERR_TIMED_OUT');
  });

  // The log is the one place the step's human summary exists on the record;
  // when the failing step never logged a line, the raw id is the honest
  // fallback rather than nothing.
  it('falls back to the step id when the log never mentioned it', () => {
    const message = composeFinishMessage(record({
      status: 'failed',
      failed_step_id: 's9',
      error: 'boom',
    }));
    expect(message.body).toContain('step s9');
    expect(message.body).toContain('boom');
  });

  it('describes a partial run as finished with a failed step', () => {
    const message = composeFinishMessage(record({
      status: 'partial',
      failed_step_id: 's3',
      error: 'No element matches #promo',
      log: [{stepId: 's3', message: 'Extract price'}],
    }));
    expect(message.title).toBe('Nightly scrape finished with a failed step');
    expect(message.body).toContain('"Extract price" failed');
    expect(message.body).toContain('No element matches #promo');
    expect(message.body).toContain('The run continued');
  });

  it('formats minutes past the first sixty seconds', () => {
    expect(composeFinishMessage(record({duration_ms: 190000})).body)
        .toContain('in 3m 10s');
  });

  it('still composes something truthful for a status it has never met', () => {
    const message = composeFinishMessage(record({status: 'exploded'}));
    expect(message.title).toContain('exploded');
    expect(message.body).toContain('exploded');
  });

  it('copes with a record missing every optional part', () => {
    const message = composeFinishMessage({status: 'failed'});
    expect(message.title).toBe('Automation failed');
    expect(message.body).toBe('Failed.');
  });
});

describe('composeFinishTelegram', () => {
  it('marks a success with the success emoji and a bold headline', () => {
    const html = composeFinishTelegram(record());
    expect(html).toBe('✅ <b>Nightly scrape finished</b>\nFinished in 42s on Amazon-3.');
  });

  // The whole point of the rich version: the error stops being a clause in a
  // sentence and becomes a block you can read and long-press to copy.
  it('lifts the error out of the prose into a pre block on a failure', () => {
    const html = composeFinishTelegram(record({
      status: 'failed',
      failed_step_id: 's2',
      error: 'net::ERR_TIMED_OUT',
      log: [{stepId: 's2', message: 'Click #login'}],
    }));
    expect(html).toBe(
        '❌ <b>Nightly scrape failed</b>\n' +
        'Failed at "Click #login" in 42s on Amazon-3.\n' +
        '<pre>net::ERR_TIMED_OUT</pre>');
  });

  // A partial keeps its own mark -- the run finished, a step did not, and
  // flattening that into either green or red loses what the reader must act on.
  it('keeps the run-continued sentence when the error moves to its own block', () => {
    const html = composeFinishTelegram(record({
      status: 'partial',
      failed_step_id: 's3',
      error: 'No element matches #promo',
      log: [{stepId: 's3', message: 'Extract price'}],
    }));
    expect(html).toBe(
        '⚠️ <b>Nightly scrape finished with a failed step</b>\n' +
        '"Extract price" failed. The run continued and finished in 42s on Amazon-3.\n' +
        '<pre>No element matches #promo</pre>');
  });

  // Selectors and scraped text are exactly the strings that carry an angle
  // bracket, and an unescaped one is a 400 that loses the whole notification.
  it('escapes every interpolated value, in the prose and in the block', () => {
    const html = composeFinishTelegram(record({
      automation_name: 'Price <watch> & co',
      status: 'failed',
      failed_step_id: 's1',
      error: 'No element matches <div class="a"> & nothing else',
      log: [{stepId: 's1', message: 'Read #promo > .price'}],
    }));
    expect(html).toContain('<b>Price &lt;watch&gt; &amp; co failed</b>');
    expect(html).toContain('Read #promo &gt; .price');
    expect(html).toContain('<pre>No element matches &lt;div class="a"&gt; &amp; nothing else</pre>');
    // The only tags in the output are the ones this composed.
    expect(html.match(/<\/?[a-z]+>/g)).toEqual(['<b>', '</b>', '<pre>', '</pre>']);
  });

  it('emits no empty block when the record carries no error', () => {
    const html = composeFinishTelegram(record({status: 'failed', failed_step_id: 's1'}));
    expect(html).not.toContain('<pre>');
    expect(html).toBe('❌ <b>Nightly scrape failed</b>\nFailed at "step s1" in 42s on Amazon-3.');
  });

  it('still marks a status it has never met, without claiming success', () => {
    const html = composeFinishTelegram(record({status: 'exploded'}));
    expect(html.startsWith('ℹ️')).toBe(true);
    expect(html).toContain('exploded');
  });
});
