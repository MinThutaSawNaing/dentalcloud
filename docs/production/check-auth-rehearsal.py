"""Server-side integration checks. Credentials stay in memory; aggregates only."""
import json
import subprocess

def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('Rehearsal command failed; sensitive output suppressed')
    return result.stdout

def sql(text, container='dental-password-rehearsal'):
    return run('docker','exec','-i',container,'psql','-X','-q','-A','-t','-h',
        '/tmp' if container=='dental-password-rehearsal' else '/run/postgresql',
        '-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1',input=(text+'\n').encode()).decode().strip()

def request(body):
    raw=run('docker','exec','-i','dental-password-rehearsal','curl','--silent','--show-error',
        '--max-time','30','-H','Content-Type: application/json','-H','Origin: https://rehearsal.invalid',
        '--data-binary','@-','http://dental-auth-edge:9000',input=json.dumps(body).encode())
    result=json.loads(raw)
    if result.get('error'):
        raise RuntimeError('Secure backend rejected test; sensitive output suppressed')
    return result

credentials=json.loads(sql("SELECT json_agg(row_to_json(c)) FROM (SELECT 'staff' AS kind,id,username AS identifier,password FROM public.users UNION ALL SELECT 'patient',a.patient_id,coalesce(nullif(a.email,''),nullif(a.username,''),p.patient_unique_id,p.name),a.password FROM public.patient_auth a JOIN public.patients p ON p.id=a.patient_id) c",'supabase-db'))
count=0
skipped_new_accounts=0
for c in credentials:
    table='users' if c['kind']=='staff' else 'patient_auth'
    column='id' if c['kind']=='staff' else 'patient_id'
    present=sql("SELECT count(*) FROM public."+table+" WHERE "+column+"='"+c['id']+"'::uuid")
    if present=='0':
        skipped_new_accounts+=1
        continue
    result=request({'action':'login','kind':c['kind'],'identifier':c['identifier'],'password':c['password']})
    row=result.get('user') if c['kind']=='staff' else result.get('patient')
    if not row or row['id']!=c['id']:
        raise RuntimeError('Correct credential or identity rejected for '+c['kind']+' account '+c['id'])
    token=row.get('auth_session_token') if c['kind']=='staff' else result.get('token')
    validated=request({'action':'validate','token':token})
    if not validated.get('session') or validated['session']['id']!=c['id']:
        raise RuntimeError('Issued session rejected')
    if c['kind']=='staff':
        alternate=request({'action':'login','kind':'staff','identifier':c['identifier'].upper(),
            'password':' '+c['password']+' '})
        if not alternate.get('user') or alternate['user']['id']!=c['id']:
            raise RuntimeError('Legacy case/space compatibility failed')
    wrong=request({'action':'login','kind':c['kind'],'identifier':c['identifier'],
        'password':c['password']+'wrong'})
    if wrong.get('user') or wrong.get('patient'):
        raise RuntimeError('Wrong password accepted')
    count+=1

tokens=json.loads(sql("SELECT coalesce(json_agg(session_token::text),'[]'::json) FROM public.staff_auth_sessions WHERE revoked_at IS NULL AND expires_at>now()",'supabase-db'))
for token in tokens:
    if not request({'action':'validate','token':token}).get('session'):
        raise RuntimeError('Existing staff session rejected')
print(json.dumps({'correctLogins':count,'wrongPasswordsRejected':count,'existingStaffTokensValid':len(tokens),'newAccountsSinceSnapshot':skipped_new_accounts}))