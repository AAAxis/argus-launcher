import {X} from 'lucide-react';
import type {ReactNode} from 'react';

// Every dialog in the app is the same three things: a backdrop that closes on
// click, a panel that does not, and a header with a title, optional subtitle
// and an X. Fifteen copies of that had drifted -- some swallowed the backdrop
// click, some forgot the close button, one stopped propagation on the wrong
// element -- so it lives here once.
export function Modal({
  onClose,
  className = '',
  nested = false,
  title,
  subtitle,
  header,
  dismissible = true,
  children,
  footer,
}: {
  onClose: () => void;
  // Extra panel classes on top of `profile-modal`, e.g. 'small-modal changelog-modal'.
  className?: string;
  // Stacks above another open modal (the fingerprint editor over the profile
  // editor) with the dimmer backdrop that pairing needs.
  nested?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  // Replaces the default title/subtitle block entirely, for headers that need
  // their own layout (the integration dialog's logo + text).
  header?: ReactNode;
  // False for dialogs that demand an explicit answer (the OAuth approval
  // prompt): no backdrop dismissal, no X.
  dismissible?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const backdropClass = nested ? 'modal-backdrop nested-backdrop' : 'modal-backdrop';
  const showHeader = Boolean(header || title || subtitle || dismissible);
  return (
    <div className={backdropClass} onMouseDown={dismissible ? onClose : undefined}>
      <section
        className={className ? `profile-modal ${className}` : 'profile-modal'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {showHeader && (
          <header>
            {header || (
              <div>
                {title && <h2>{title}</h2>}
                {subtitle && <p>{subtitle}</p>}
              </div>
            )}
            {dismissible && (
              <button className="icon-button" aria-label="Close" onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </header>
        )}
        {children}
        {footer && <footer className="modal-actions">{footer}</footer>}
      </section>
    </div>
  );
}
