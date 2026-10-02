"""Production conversion runner; server only, secrets in memory, no secret output.

Uses the validated pinned hash-wasm implementation in a separate worker container.
Requires reviewed prepare SQL applied and a fresh restricted backup.
"""
import json
import subprocess
import sys

TARGET='dental-password-rehearsal' if '--rehearsal' in sys.argv else 'supabase-db'

def command(args, data=None):
    r=subprocess.run(args,input=data,capture_output=True)
    if r.returncode: raise RuntimeError('Migration command failed; output suppressed')
    return r.stdout.decode().strip()

def query(sql):
    role='postgres' if TARGET=='dental-password-rehearsal' else 'supabase_admin'
    args=['docker','exec','-i',TARGET,'psql','-X','-q','-A','-t','-U',role,'-d','postgres','-v','ON_ERROR_STOP=1']
    if TARGET=='dental-password-rehearsal': args+=['-h','/tmp']
    return command(args,sql.encode())

def literal(value):
    if '\0' in value: raise RuntimeError('Invalid string')
    return "'"+value.replace("'","''")+"'"

source=query("BEGIN READ ONLY; SELECT coalesce(json_agg(row_to_json(c)),'[]'::json) FROM (SELECT 'users' AS source,id,password,password_scheme FROM public.users UNION ALL SELECT 'doctors',id,password,password_scheme FROM public.doctors UNION ALL SELECT 'patient_auth',id,password,password_scheme FROM public.patient_auth) c; ROLLBACK;")
if TARGET=='supabase-db':
    safe=query("SELECT NOT has_column_privilege('anon','public.patient_auth','password','SELECT') AND NOT has_column_privilege('anon','public.doctors','password','SELECT') AND NOT has_function_privilege('anon','public.authenticate_staff_user_session(text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.authenticate_staff_user(text,text)','EXECUTE')")
    if safe!='t':raise RuntimeError('Mandatory credential freeze has not passed')
records=json.loads(source)
pending=[r for r in records if r['password'] is not None and r['password_scheme'] is None]
result=command(['docker','exec','-i','dental-password-rehearsal','curl','-s','--max-time','120',
    '-H','Content-Type: application/json','--data-binary','@-','http://dental-password-hasher:9000'],
    json.dumps(pending).encode())
hashes=json.loads(result)
if len(hashes)!=len(pending): raise RuntimeError('Incomplete hash result')
updates=[]
for r,h in zip(pending,hashes):
    if r['source'] not in ('users','doctors','patient_auth') or not h.get('verified'):
        raise RuntimeError('Invalid verified hash result')
    if not h.get('hash','').startswith('$argon2id$'): raise RuntimeError('Invalid hash')
    scheme='argon2id-exact-v1' if r['source']=='patient_auth' else 'argon2id-trim-v1'
    updates.append(f"UPDATE public.{r['source']} SET password={literal(h['hash'])},password_scheme={literal(scheme)} WHERE id={literal(r['id'])}::uuid AND password={literal(r['password'])} AND password_scheme IS NULL;")
logging="SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_transaction_sample_rate=0;"
if TARGET=='supabase-db':
    logging+="SET LOCAL pgaudit.log='none'; SET LOCAL pgaudit.log_parameter=off; SET LOCAL auto_explain.log_min_duration=-1;"
query("BEGIN; "+logging+" SET LOCAL private_auth.migration='on'; SET LOCAL standard_conforming_strings=on; SET LOCAL lock_timeout='3s';\n"+'\n'.join(updates)+"\nDO $$ BEGIN IF EXISTS (SELECT 1 FROM public.users WHERE password_scheme IS NULL AND password IS NOT NULL UNION ALL SELECT 1 FROM public.doctors WHERE password_scheme IS NULL AND password IS NOT NULL UNION ALL SELECT 1 FROM public.patient_auth WHERE password_scheme IS NULL AND password IS NOT NULL) THEN RAISE EXCEPTION 'Concurrent credential change: retry conversion'; END IF; END $$; COMMIT;")
stored=json.loads(query("SELECT json_agg(row_to_json(c)) FROM (SELECT 'users' AS source,id,password AS hash FROM public.users UNION ALL SELECT 'doctors',id,password FROM public.doctors UNION ALL SELECT 'patient_auth',id,password FROM public.patient_auth) c"))
by_id={(r['source'],r['id']):r['hash'] for r in stored}
verification=[{'source':r['source'],'password':r['password'],'hash':by_id[(r['source'],r['id'])]} for r in pending]
verified=json.loads(command(['docker','exec','-i','dental-password-rehearsal','curl','-s','--max-time','120',
    '-H','Content-Type: application/json','--data-binary','@-','http://dental-password-hasher:9000'],
    json.dumps({'action':'verify','records':verification}).encode()))
if verified.get('verified')!=len(pending): raise RuntimeError('Stored hash verification failed')
print(json.dumps({'converted':len(pending),'storedHashesVerified':verified['verified'],'target':TARGET}))