import {RefreshCw} from 'lucide-react';
import type {ReactNode} from 'react';

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
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      className={className}
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? <RefreshCw size={16} className="btn-spin" /> : icon}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
