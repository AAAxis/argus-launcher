// A small panel anchored to a button, opened by clicking it.
//
// The app had no floating layer at all -- every "what is this field" and "pick
// one of these" affordance was either a native title= tooltip or a <select>.
// This is the one place that behaviour lives, so InfoHint and the status picker
// cannot drift apart on dismissal, keyboard handling or which edge they flip to.
//
// The panel is position: fixed rather than absolute inside a relative wrapper,
// because every dialog it opens in is itself an `overflow: auto` box
// (.profile-modal, .profile-summary) that would otherwise clip it. The cost is
// that a fixed panel does not follow its trigger when something scrolls, so
// scrolling closes it.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';

const GAP = 6;
const MARGIN = 12;

export function Popover({
  label,
  trigger,
  triggerClassName = 'icon-button',
  panelClassName = '',
  width = 300,
  disabled = false,
  children,
}: {
  // Accessible name for the trigger button; the trigger itself is a glyph.
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  width?: number;
  // For a picker whose list is momentarily empty. Shown and greyed rather than
  // removed: the trigger is how you learn the choice exists at all.
  disabled?: boolean;
  // A function when the contents need to dismiss the panel themselves (picking
  // an option); a plain node when they are only there to be read.
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{left: number; top: number} | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Measured after paint but before the browser shows it, so the panel never
  // renders once at 0,0 and then jumps to where it belongs.
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) {
      return;
    }
    const rect = anchor.current.getBoundingClientRect();
    const height = panel.current.offsetHeight;
    // Right-aligned to the trigger by default, because most triggers sit at the
    // right of a label or a row. When that would run off the left edge -- an
    // "i" early in a form label -- align the panel's left edge to the trigger
    // instead of shoving it against the window, so it still reads as belonging
    // to that control.
    const rightAligned = rect.right - width;
    const left = Math.min(
        rightAligned < MARGIN ? Math.max(MARGIN, rect.left) : rightAligned,
        window.innerWidth - width - MARGIN);
    // Below unless below does not fit and above does.
    const below = rect.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    setPosition({left, top: fitsBelow ? below : Math.max(MARGIN, rect.top - GAP - height)});
  }, [open, width]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    // mousedown rather than click: a click listener fires after the button's
    // own onClick has already reopened it, so the panel would never close.
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) {
        close();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        anchor.current?.focus();
      }
    };
    // Scrolling the page strands a fixed panel away from its trigger, so it
    // closes. A scroll *inside* the panel is the user reading a list that does
    // not fit, and closing on that makes a scrollable panel unusable -- the
    // first wheel tick dismisses it.
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointer);
    // Capture, so a scroll inside the dialog counts and not just the window's.
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={label}
        className={triggerClassName}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        ref={anchor}
        type="button"
      >
        {trigger}
      </button>
      {open && !disabled && (
        <div
          className={panelClassName ? `popover-panel ${panelClassName}` : 'popover-panel'}
          ref={panel}
          role="dialog"
          aria-label={label}
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? 'visible' : 'hidden',
            width,
          }}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </>
  );
}
