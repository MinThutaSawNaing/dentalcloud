// Synthetic-only rehearsal entrypoint. Never deploy as a public function.
import { hashPassword, verifyPassword } from '../_shared/passwords.ts';

const password = '  synthetic Unicode 🔐 ' + 'x'.repeat(90);
const hash = await hashPassword(password);
const correct = await verifyPassword(password, hash);
const incorrect = await verifyPassword(password + 'wrong', hash);
if (!correct || incorrect) throw new Error('Password runtime compatibility failed');
console.log('PASSWORD_RUNTIME_CHECK_PASSED');
Deno.serve(() => new Response('synthetic rehearsal only', { status: 503 }));