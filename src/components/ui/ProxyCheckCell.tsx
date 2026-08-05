// The result of a proxy check, as one chip.
//
// Shared rather than written per table because a proxy's health is asked in four
// places -- the Proxies tab, the Profiles tab's proxy column, the import review
// table and the proxy editor -- and the three that had their own version said the
// same thing three different ways: bare text here, a coloured span there, and a
// "Failed · <the whole curl error>" that pushed the row to two lines.
//
// A chip instead of text because this column is scanned, not read: the shape and
// the colour carry the verdict, and the detail lives in the title so a table of
// forty proxies stays a table.
import {CircleAlert} from 'lucide-react';
import {CopyButton} from './CopyButton';
import {Popover} from './Popover';
import {FlagIcon} from './icons';
import type {ArgusProxy} from '../../types';

export type ProxyCheckState =
  | {status: 'unchecked'}
  | {status: 'checking'}
  | {status: 'ok'; pingMs?: number; country?: string; countryCode?: string}
  | {status: 'fail'; error?: string};

// Coarse on purpose: a check is a background sweep, and "3h ago" is the only
// resolution anyone acts on. Anything older than a week is a date.
export function sinceLabel(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'unknown';
  }
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return days <= 7 ? `${days}d ago` : iso.slice(0, 10);
}

// A stored proxy's persisted check, as the chip's state. The six last_* columns
// are written by every check path (background sweep, manual button, import
// review), so a restart shows the same chip the check produced.
export function storedCheckState(proxy: ArgusProxy | null | undefined): ProxyCheckState {
  if (!proxy) {
    return {status: 'unchecked'};
  }
  if (proxy.check_error) {
    return {status: 'fail', error: proxy.check_error};
  }
  if (!proxy.checked_at) {
    return {status: 'unchecked'};
  }
  return {
    status: 'ok',
    pingMs: proxy.ping_ms,
    country: proxy.country,
    countryCode: proxy.country_code,
  };
}

// `age` is the checked_at behind the chip's "checked 13m ago" tooltip. Passed in
// rather than read off the proxy so the import review table -- whose results are
// dialog state and never written to a row -- can use the same chip with no date.
export function ProxyCheckCell({state, age, className = ''}: {
  state: ProxyCheckState;
  age?: string;
  className?: string;
}) {
  const classes = (tone: string) => `proxy-check ${tone} ${className}`.trim();

  if (state.status === 'checking') {
    return <span className={classes('checking')}>Checking…</span>;
  }
  if (state.status === 'unchecked') {
    return <span className={classes('unchecked')}>Not checked</span>;
  }
  if (state.status === 'fail') {
    const error = state.error || 'Proxy check failed';
    // The message is never in the cell. It can be a whole sentence ("Proxy needs
    // a username and password (407 Proxy Authentication Required)"), and a
    // column that grows to fit it is a column that has stopped being scannable.
    //
    // It used to live only in the title, which meant the one text worth pasting
    // into a provider's support chat could be read but not taken -- a tooltip is
    // not selectable. So the chip opens instead, and the panel is where the
    // message and the copy live. The title stays for the hover that just wants
    // to know.
    return (
      // Stops the open click reaching a row that has its own handler. None of
      // today's four call sites do, but this chip is dropped into table rows and
      // that is exactly the kind of thing a later row grows.
      <span className="proxy-check-fail" onClick={(event) => event.stopPropagation()}>
        <Popover
          label="Why this check failed"
          width={300}
          triggerClassName={classes('failed')}
          trigger={
            <>
              <CircleAlert size={12} />
              Failed
            </>
          }
        >
          <p className="proxy-fail-message" title={error}>{error}</p>
          <div className="proxy-fail-actions">
            <CopyButton value={error} label="Copy error" />
          </div>
        </Popover>
      </span>
    );
  }

  // Flag and latency only. It used to read "709 ms · US · 13m ago", which was
  // three facts where the flag already carried one of them: the country is the
  // flag, and it also has its own column in the Proxies table. The age is real
  // information but not what this column is scanned for -- so both move to the
  // title rather than being dropped, and a stale check is still one hover away.
  const detail = typeof state.pingMs === 'number' ? `${state.pingMs} ms` : 'Reachable';
  const title = [
    state.country ? `Egress in ${state.country}` : '',
    age ? `checked ${sinceLabel(age)}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <span className={classes('ok')} title={title || undefined}>
      {state.countryCode && <FlagIcon countryCode={state.countryCode} />}
      {detail}
    </span>
  );
}
