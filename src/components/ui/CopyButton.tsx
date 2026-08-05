// Copy one string, and say so for a moment afterwards.
//
// The confirmation is the point. navigator.clipboard.writeText resolves
// silently, so a bare "Copy error" button gives no sign it did anything, and the
// text it copied is usually a paste away from a support chat where getting it
// wrong is expensive. Six call sites had each grown their own copied-flag state
// and their own timeout; this is that pattern once.
import {useEffect, useRef, useState} from 'react';
import {Check, Copy} from 'lucide-react';

export function CopyButton({value, label = 'Copy', copiedLabel = 'Copied', className = 'ghost'}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  // Cleared on unmount, or a panel closed inside the window would set state on a
  // component that is gone -- these buttons live in popovers and dialogs that
  // are routinely dismissed within the confirmation's own lifetime.
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className={className} onClick={() => void copy()} type="button">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? copiedLabel : label}
    </button>
  );
}
