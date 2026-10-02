"""Tests account writes only on the isolated stack. No real accounts changed."""
import json
import subprocess

def sql(q):
    r=subprocess.run(['docker','exec','-i','dental-password-rehearsal','psql','-X','-q','-A','-t','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True)
    if r.returncode: raise RuntimeError('Rehearsal query failed')
    return r.stdout.decode().strip()
def req(b):
    r=subprocess.run(['docker','exec','-i','dental-password-rehearsal','curl','-s','-H','Content-Type: application/json','-H','Origin: https://rehearsal.invalid','--data-binary','@-','http://dental-auth-edge:9000'],input=json.dumps(b).encode(),capture_output=True)
    if r.returncode:raise RuntimeError('Rehearsal request failed')
    return json.loads(r.stdout) if r.stdout.strip() else None

token=sql("SELECT s.session_token FROM public.staff_auth_sessions s JOIN public.users u ON u.id=s.user_id WHERE u.role='admin' AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1")
created=req({'action':'mutate','table':'users','method':'POST','query':'?select=*','prefer':'return=representation',
    'token':token,'payload':{'username':'synthetic_security_rehearsal','password':' exact new password ','role':'normal'}})
if not isinstance(created,list) or not created:raise RuntimeError('Staff account creation failed')
if 'password' in created[0] or 'password_scheme' in created[0]:raise RuntimeError('Credential leaked')
identity=created[0]['id']
if not req({'action':'login','kind':'staff','identifier':'synthetic_security_rehearsal','password':' exact new password '}).get('user'):
    raise RuntimeError('New account login failed')
if req({'action':'login','kind':'staff','identifier':'synthetic_security_rehearsal','password':'exact new password'}).get('user'):
    raise RuntimeError('New password silently trimmed')
changed=req({'action':'mutate','table':'users','method':'PATCH','query':'?id=eq.'+identity,'prefer':'return=representation',
    'token':token,'payload':{'password':'synthetic changed password'}})
if not isinstance(changed,list):raise RuntimeError('Password change failed')
if not req({'action':'login','kind':'staff','identifier':'synthetic_security_rehearsal','password':'synthetic changed password'}).get('user'):
    raise RuntimeError('Changed password rejected')
req({'action':'mutate','table':'users','method':'DELETE','query':'?id=eq.'+identity,'token':token})
print(json.dumps({'staffCreate':True,'safeResponse':True,'exactNewPassword':True,'passwordChange':True,'cleanup':True}))