import { hashPassword, verifyPassword } from './passwords.ts';

Deno.test('login verifies the correct password and rejects a wrong password', async () => {
  const hash = await hashPassword('synthetic password');
  if (!await verifyPassword('synthetic password', hash)) throw new Error('Correct password rejected');
  if (await verifyPassword('wrong password', hash)) throw new Error('Wrong password accepted');
});

Deno.test('migration preserves Unicode, spaces, and passwords beyond 72 bytes', async () => {
  for (const password of ['  exact spaces  ', 'သွားဆေးခန်း🔐 café', 'x'.repeat(90) + 'A']) {
    const hash = await hashPassword(password);
    if (!await verifyPassword(password, hash)) throw new Error('Exact password rejected');
    if (await verifyPassword(password + 'B', hash)) throw new Error('Different suffix accepted');
    if (password.trim() !== password && await verifyPassword(password.trim(), hash)) {
      throw new Error('Password was silently trimmed');
    }
  }
});

Deno.test('equal passwords receive different random salted hashes', async () => {
  const first = await hashPassword('synthetic same password');
  const second = await hashPassword('synthetic same password');
  if (first === second) throw new Error('Salt reused');
  if (!await verifyPassword('synthetic same password', second)) throw new Error('Salted verification failed');
});

Deno.test('login fails closed for empty credentials and malformed hashes', async () => {
  if (await verifyPassword('', '')) throw new Error('Empty credential accepted');
  if (await verifyPassword('synthetic', 'plaintext')) throw new Error('Plaintext accepted');
  if (await verifyPassword('synthetic', '$argon2id$v=19$m=999999999,t=2,p=1$x$y')) {
    throw new Error('Unbounded hash accepted');
  }
  let rejected = false;
  try { await hashPassword(''); } catch { rejected = true; }
  if (!rejected) throw new Error('Empty password hashed');
});