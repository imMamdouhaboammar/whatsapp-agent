/** WA-024: read transport/profile feature rows from /api/runtime/capabilities. */
export interface CapabilityRow {
  capability: string;
  enabled: boolean;
  reason: string;
}

/**
 * True when `name` is present and enabled. When the row is absent (older
 * backend or fetch failure), fall back so existing supported behavior is
 * preserved; only an explicit disabled row hides an action.
 */
export function featureEnabled(rows: CapabilityRow[], name: string, fallback: boolean): boolean {
  const row = rows.find((r) => r.capability === name);
  return row ? row.enabled : fallback;
}
