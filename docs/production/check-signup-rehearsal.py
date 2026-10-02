"""Public signup proof and resend tests; private fake mail adapter, no delivery."""
exec(open('/root/password-security-rehearsal-20261002/check-reset-rehearsal.py').read().split("c=json.loads")[0])
import hashlib

address='synthetic-security-rehearsal@example.invalid'
password='synthetic signup password'
created=req({'action':'signup','email':address,'password':password,
    'profile':{'username':'synthetic_signup_security','phone':'09123456789','age':25,'city':'Yangon'}})
if not created.get('success'):raise RuntimeError('Signup failed')
if req({'action':'login','kind':'patient','identifier':address,'password':password}).get('patient'):
    raise RuntimeError('Unverified signup accepted')
if not req({'action':'resend','email':address}).get('success'):raise RuntimeError('Resend failed')
code='synthetic-signup-proof'
digest=hashlib.sha256(code.encode()).hexdigest()
sql("SELECT public.secure_auth_code('"+address+"','signup','"+digest+"')")
if not req({'action':'verify-signup','email':address,'code':code}).get('success'):
    raise RuntimeError('Signup verification failed')
if not req({'action':'login','kind':'patient','identifier':address,'password':password}).get('patient'):
    raise RuntimeError('Verified signup login failed')
if not req({'action':'reset-request','email':address}).get('success'):raise RuntimeError('Recovery mail request failed')
sql("DELETE FROM public.patients WHERE id IN (SELECT patient_id FROM public.patient_auth WHERE email='"+address+"'); DELETE FROM private_auth.email_codes WHERE email='"+address+"';")
print(json.dumps({'signup':True,'unverifiedBlocked':True,'resendWithoutPassword':True,'verifiedLogin':True,'recoveryMailAdapter':True}))