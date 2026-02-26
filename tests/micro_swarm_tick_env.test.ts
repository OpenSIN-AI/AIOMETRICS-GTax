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
