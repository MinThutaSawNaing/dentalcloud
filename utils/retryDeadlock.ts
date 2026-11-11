// PostgreSQL rolls back the entire failed transaction before returning 40P01.
// Retry only that error, never timeouts/network failures with unknown outcomes.
export const retryDeadlock = async <T extends { error: { code?: string } | null }>(
  request: () => PromiseLike<T>
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    const result = await request();
    if (result.error?.code !== '40P01' || attempt >= 2) return result;
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
  }
};