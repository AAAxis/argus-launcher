// "2m ago" / "3h ago" / "2d ago", or the date once it stops being recent.
// Shared by the bell and the automation cards -- a glanced-at timestamp, not
// an audit trail; the underlying records carry the exact values.
export function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const minutes = Math.floor(ms / 60000);
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return iso.slice(0, 10);
}
