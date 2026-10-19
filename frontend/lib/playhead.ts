/** Keep the requested position while the iframe is still acknowledging a seek. */
export function resolvePlayhead(actual: number, requested: number, deadline: number, now = Date.now()): number | null {
  if (now < deadline && (!Number.isFinite(actual) || Math.abs(actual - requested) > 2)) return Math.floor(requested);
  return Number.isFinite(actual) ? Math.floor(actual) : null;
}
