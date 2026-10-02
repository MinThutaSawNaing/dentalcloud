import { argon2id, argon2Verify } from 'npm:hash-wasm@4.12.0';

// Server-only. Passwords are exact strings: never trim, normalize, or truncate.
// Legacy matching rules belong to the migration/login adapter, not this module.
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('A non-empty password is required');
  }
  return await argon2id({
    password,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || !password || typeof hash !== 'string') return false;
  // Accept only our bounded parameters, preventing untrusted encoded hashes
  // from requesting excessive memory/CPU. Expand explicitly for future versions.
  if (!/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(hash)) {
    return false;
  }
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}