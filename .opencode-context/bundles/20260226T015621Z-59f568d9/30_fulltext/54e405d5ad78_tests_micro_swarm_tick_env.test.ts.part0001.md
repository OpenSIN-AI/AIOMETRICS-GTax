# Context Fulltext

- source_path: tests/micro_swarm_tick_env.test.ts
- source_sha256: f780c8e78ce8bea2a92f9b012767101027d5ac8bd96c6ff54f94c170bfcf3609
- chunk: 1/1

```text
import { describe, expect, it } from 'vitest';
import { parseEnabledFlag } from '../src/orchestrator/micro_swarm_tick.js';

describe('micro_swarm_tick parseEnabledFlag', () => {
  it('accepts truthy values with whitespace/case variants', () => {
    expect(parseEnabledFlag('1')).toBe(true);
    expect(parseEnabledFlag(' TRUE ')).toBe(true);
    expect(parseEnabledFlag('On')).toBe(true);
    expect(parseEnabledFlag('enabled')).toBe(true);
  });

  it('accepts explicit false values', () => {
    expect(parseEnabledFlag('0')).toBe(false);
    expect(parseEnabledFlag(' false ')).toBe(false);
    expect(parseEnabledFlag('OFF')).toBe(false);
    expect(parseEnabledFlag('disabled')).toBe(false);
  });

  it('falls back to default for undefined/unknown values', () => {
    expect(parseEnabledFlag(undefined, true)).toBe(true);
    expect(parseEnabledFlag(undefined, false)).toBe(false);
    expect(parseEnabledFlag('maybe', true)).toBe(true);
    expect(parseEnabledFlag('maybe', false)).toBe(false);
    expect(parseEnabledFlag('', true)).toBe(true);
  });
});

```
