import { describe, expect, it, vi } from 'vitest';
import { retryDeadlock } from './retryDeadlock';

describe('retryDeadlock', () => {
  it('retries a rolled-back PostgreSQL deadlock then returns success', async () => {
    const request = vi.fn().mockResolvedValueOnce({ error: { code: '40P01' } }).mockResolvedValue({ data: 'saved', error: null });
    expect(await retryDeadlock(request)).toEqual({ data: 'saved', error: null });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('bounds retries and never retries an ambiguous failure', async () => {
    const deadlock = vi.fn().mockResolvedValue({ error: { code: '40P01' } });
    await retryDeadlock(deadlock);
    expect(deadlock).toHaveBeenCalledTimes(3);
    const network = vi.fn().mockResolvedValue({ error: { code: 'NETWORK' } });
    await retryDeadlock(network);
    expect(network).toHaveBeenCalledTimes(1);
  });
});