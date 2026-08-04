// The "re-roll this fingerprint" button, in the two places that offer one: the
// fingerprint dialog's footer and the Summary panel's heading.
//
// Rotating is synchronous -- randomFingerprintPatch() returns a new draft in the
// same tick -- so unlike BusyButton there is nothing to wait on. That was the
// problem: clicking it changed a dozen values in a scrolled-away column and gave
// no sign anything had happened, and the two buttons that do it looked and
// behaved differently. One turn of the icon is the acknowledgement.
import {useEffect, useRef, useState} from 'react';
import {RefreshCw} from 'lucide-react';

// One full 0.8s turn, matching .btn-spin's period so a rotate and an in-flight
// save spin at the same rate rather than beating against each other.
const SPIN_MS = 800;

export function RotateButton({onRotate, className = 'ghost', children}: {
  onRotate: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleClick() {
    onRotate();
    // Restart the animation on a rapid second click rather than letting the
    // first timeout end it early: drop the class, then re-add it next frame.
    setSpinning(false);
    clearTimeout(timer.current);
    requestAnimationFrame(() => {
      setSpinning(true);
      timer.current = setTimeout(() => setSpinning(false), SPIN_MS);
    });
  }

  return (
    <button className={className} type="button" onClick={handleClick}>
      <RefreshCw size={15} className={spinning ? 'rotate-spin' : undefined} />
      {children}
    </button>
  );
}
