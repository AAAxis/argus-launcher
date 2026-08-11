export function LoadingState({label, detail, failed = false, onRetry}: {
  label: string;
  detail: string;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <section className="loading-state">
      {!failed && <div className="spinner" aria-hidden="true" />}
      <h1>{label}</h1>
      <p>{detail}</p>
      {failed && onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </section>
  );
}
