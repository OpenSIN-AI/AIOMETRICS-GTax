export const RUNTIME_POLICY = {
  // Hard upper bound for a single worker run (under 3 minutes).
  defaultRunBudgetMs: 170000,
  // Reserve at end of budget so runners can exit cleanly.
  budgetReserveMs: 10000,
  // Default timeout for external OCR/API model calls.
  defaultModelTimeoutMs: 25000
} as const;

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

