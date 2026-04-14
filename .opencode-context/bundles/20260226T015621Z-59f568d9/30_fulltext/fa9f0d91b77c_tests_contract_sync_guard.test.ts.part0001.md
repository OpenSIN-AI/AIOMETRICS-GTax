# Context Fulltext

- source_path: tests/contract_sync_guard.test.ts
- source_sha256: cb5cb564475a1d2e6323018b5dc67182613f5fb8055120be147761cd721eef2d
- chunk: 1/1

```text
import { describe, expect, it } from 'vitest';
import { normalizeComparableValue } from '../src/orchestrator/contract_sync_guard.js';

describe('contract_sync_guard normalizeComparableValue', () => {
  it('normalizes numeric values to fixed 2 decimals', () => {
    expect(normalizeComparableValue(12)).toBe('12.00');
    expect(normalizeComparableValue('12,5')).toBe('12.50');
    expect(normalizeComparableValue('1.234,56')).toBe('1234.56');
  });

  it('keeps non-numeric strings as-is', () => {
    expect(normalizeComparableValue('OK')).toBe('OK');
    expect(normalizeComparableValue('  ABC  ')).toBe('ABC');
    expect(normalizeComparableValue('')).toBe('');
  });
});

```
