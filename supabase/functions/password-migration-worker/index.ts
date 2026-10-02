// Private, network-isolated administrative worker. NEVER mount in public router.
import { hashPassword, verifyPassword } from '../_shared/passwords.ts';

Deno.serve(async req => {
  try {
    const records = await req.json();
    if (records?.action === 'verify') {
      for (const record of records.records) {
        const password = record.source === 'patient_auth' ? record.password : record.password.trim();
        if (!await verifyPassword(password, record.hash) || await verifyPassword(password + '\u0001wrong', record.hash)) {
          throw new Error('Stored credential verification failed');
        }
      }
      return Response.json({ verified: records.records.length });
    }
    if (records?.action === 'synthetic-selftest') {
      const hash=await hashPassword('synthetic worker test');
      return Response.json({verified:await verifyPassword('synthetic worker test',hash)});
    }
    if (!Array.isArray(records) || records.length > 10000) throw new Error('Invalid batch');
    const result = [];
    for (const record of records) {
      const password = String(record.password);
      const normalized = record.source === 'patient_auth' ? password : password.trim();
      const hash = await hashPassword(normalized);
      const verified = await verifyPassword(normalized, hash)
        && !await verifyPassword(normalized + '\u0001wrong', hash);
      if (!verified) throw new Error('Hash verification failed');
      result.push({ hash, verified });
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Private migration failed' }, { status: 500 });
  }
});