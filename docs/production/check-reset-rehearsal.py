"""Isolated reset/session/authorization integration checks, no email delivery."""
import hashlib
import json
import subprocess

def run(args,data=None):
    r=subprocess.run(args,input=data,capture_output=True)
    if r.returncode: raise RuntimeError('Rehearsal command failed; output suppressed')
    return r.stdout.decode().strip()
def sql(q):
    return run(['docker','exec','-i','dental-password-rehearsal','psql','-X','-q','-A','-t','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],q.encode())
def req(b):
    return json.loads(run(['docker','exec','-i','dental-password-rehearsal','curl','-s','-H','Content-Type: application/json','-H','Origin: https://rehearsal.invalid','--data-binary','@-','http://dental-auth-edge:9000'],json.dumps(b).encode()))

c=json.loads(sql("SELECT json_build_object('id',patient_id,'email',email) FROM public.patient_auth WHERE email LIKE '%@%.%' LIMIT 1"))
# Synthetic token is never emailed and changes only the isolated copied account.
code='synthetic-reset-rehearsal-token'
digest=hashlib.sha256(code.encode()).hexdigest()
address=c['email'].replace("'","''")
sql("SELECT public.secure_auth_code('"+address+"','reset','"+digest+"')")
password='  synthetic reset Unicode 🔐 '+('x'*90)
changed=req({'action':'reset-complete','email':c['email'],'code':code,'password':password})
if not changed.get('success'): raise RuntimeError('Reset rejected')
reused=req({'action':'reset-complete','email':c['email'],'code':code,'password':password+'wrong'})
if reused.get('success'): raise RuntimeError('Reset token reused')
login=req({'action':'login','kind':'patient','identifier':c['email'],'password':password})
if login.get('patient',{}).get('id')!=c['id']: raise RuntimeError('New password login failed')
token=login['token']
blocked=req({'action':'mutate','table':'users','method':'PATCH','query':'?id=eq.'+c['id'],'token':token,'payload':{'role':'admin'}})
if not blocked.get('error'): raise RuntimeError('Patient privilege escalation accepted')
req({'action':'logout','token':token})
if req({'action':'validate','token':token}).get('session'): raise RuntimeError('Revoked token accepted')
access=sql("SELECT has_column_privilege('anon','public.patient_auth','password','SELECT') OR has_table_privilege('anon','public.users','UPDATE') OR has_table_privilege('anon','public.otp_codes','SELECT')")
if access!='f': raise RuntimeError('Anonymous credential access remains')
print(json.dumps({'resetLogin':True,'tokenReuseBlocked':True,'patientEscalationBlocked':True,'logoutRevoked':True,'anonymousCredentialAccessBlocked':True}))