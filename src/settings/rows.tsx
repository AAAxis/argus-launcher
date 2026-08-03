// The three shapes every settings section is built from.
//
// Row keeps the grid the old settings modal already used -- label and
// explanation on the left, control on the right, hairline between -- so the new
// dialog inherits the type scale and spacing rather than inventing a second one.
import type {ReactNode} from 'react';

export function SettingsGroup({title, children}: {title?: string; children: ReactNode}) {
  return (
    <section className="settings-group">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  wide,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  // For a control too large for the right-hand track (the update panel, the
  // theme cards): the label stacks above it and both take the full width.
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'settings-row wide' : 'settings-row'}>
      <div className="settings-row-label">
        <h4>{label}</h4>
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
