# Context Fulltext

- source_path: src/orchestrator/shared/runtime_policy.ts
- source_sha256: 1becea62d15ac382780714030657951aef5e8c58a99463f3c31900f1428ed920
- chunk: 1/1

```text
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


```
