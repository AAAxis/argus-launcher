import {RefreshCw} from 'lucide-react';
import type {MouseEvent, ReactNode} from 'react';

// A button whose leading icon becomes a spinner while its action is in flight,
// optionally swapping the label too. Six call sites had hand-rolled this with
// three slightly different shapes; the disabled-while-busy part was the one
// that kept getting forgotten, which is how a double-click could fire two
// launches or two saves.
export function BusyButton({
  busy,
  icon,
  busyLabel,
  className,
  type = 'button',
  disabled,
  onClick,
  title,
  ariaLabel,
  children,
}: {
  busy: boolean;
  // Shown when idle; replaced by the spinner while busy. Omit for buttons that
  // carry no icon (or whose icon lives inside `children`).
  icon?: ReactNode;
  // Replaces the label while busy ("Saving…"). Omit to keep the label fixed.
  busyLabel?: string;
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  // Takes the event so a busy button inside a clickable table row can
  // stopPropagation, the same way the plain row-action buttons do. Existing
  // call sites that ignore it keep type-checking -- a handler may always
  // declare fewer parameters than it is given.
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  // Both, not either: an icon-only busy button needs the accessible name and
  // the hover tooltip, and forgetting one of them is the usual way an icon
  // button ends up unlabelled.
  title?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
      title={title}
    >
      {busy ? <RefreshCw size={16} className="btn-spin" /> : icon}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
