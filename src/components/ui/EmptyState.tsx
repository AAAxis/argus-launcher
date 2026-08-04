// The one shape both tabs' empty states take. `hero` is the library-is-empty
// version -- same parts, more room and a heavier glyph, because it is the whole
// screen rather than a row inside a table that still has its headers.
//
// Lifted out of ProfilesTab when the Proxies tab grew the same three states
// (nothing here at all / this folder is empty / nothing matches those filters).
import type {ReactNode} from 'react';

export function EmptyState({icon, title, body, hero, children}: {
  icon: ReactNode;
  title: string;
  body: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={hero ? 'table-empty hero' : 'table-empty'}>
      <span className="table-empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {children && <div className="table-empty-actions">{children}</div>}
    </div>
  );
}
