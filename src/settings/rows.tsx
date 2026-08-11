// The three shapes every settings section is built from.
//
// Row keeps the grid the old settings modal already used -- label and
// explanation on the left, control on the right, hairline between -- so the new
// dialog inherits the type scale and spacing rather than inventing a second one.
import type {ReactNode} from 'react';

export function SettingsGroup({title, className, children}: {
  title?: string;
  // An extra class on the section, for a group that needs to colour what it
  // contains -- the plan usage meters, which are the shared Meter drawn in the
  // plan accent rather than the app's ink one.
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `settings-group ${className}` : 'settings-group'}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  icon,
  children,
  wide,
}: {
  label: string;
  description?: ReactNode;
  // An optional lucide glyph beside the label, for a group whose rows are a
  // list of different things rather than variations on one -- the usage meters,
  // where the icon is what tells profiles from automations from members at a
  // glance. A row without one is unindented, so a section that uses no icons is
  // laid out exactly as it was.
  icon?: ReactNode;
  children?: ReactNode;
  // For a control too large for the right-hand track (the update panel, the
  // theme cards): the label stacks above it and both take the full width.
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'settings-row wide' : 'settings-row'}>
      <div className="settings-row-label">
        <h4>
          {icon && <span className="settings-row-icon" aria-hidden="true">{icon}</span>}
          {label}
        </h4>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

// A read-only value shown where a control would otherwise sit.
export function SettingsValue({children, title}: {children: ReactNode; title?: string}) {
  return <span className="settings-value" title={title}>{children}</span>;
}
