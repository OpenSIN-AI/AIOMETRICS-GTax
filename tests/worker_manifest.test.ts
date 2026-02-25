import { describe, expect, it } from 'vitest';
import { ACTIVE_WORKERS, LEGACY_WORKERS, MICIO_PROFILE_WORKERS, WORKER_MANIFEST } from '../src/orchestrator/worker_manifest.js';

describe('worker_manifest', () => {
  it('has unique worker ids', () => {
    const ids = WORKER_MANIFEST.map((worker) => worker.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps active and legacy disjoint', () => {
    const active = new Set(ACTIVE_WORKERS.map((worker) => worker.id));
    const legacy = new Set(LEGACY_WORKERS.map((worker) => worker.id));
    for (const id of legacy) {
      expect(active.has(id)).toBe(false);
    }
  });

  it('ensures micio profile workers are active and have dist entry', () => {
    const activeById = new Map(ACTIVE_WORKERS.map((worker) => [worker.id, worker]));
    for (const profileWorkers of Object.values(MICIO_PROFILE_WORKERS)) {
      expect(profileWorkers.length).toBeGreaterThan(0);
      for (const id of profileWorkers) {
        const worker = activeById.get(id);
        expect(worker).toBeTruthy();
        expect(worker?.distEntry).toBeTruthy();
      }
    }
  });
});
