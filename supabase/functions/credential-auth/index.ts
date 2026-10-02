import { hashPassword, verifyPassword } from '../_shared/passwords.ts';

const base = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const restBase = Deno.env.get('AUTH_REHEARSAL_REST_URL') || `${base}/rest/v1`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info' };
const safeColumns: Record<string,string> = {
  users: 'id,location_id,username,role,allowed_tabs,doctor_id,created_at,updated_at',
  doctors: 'id,location_id,name,email,phone,specialization,commission_percentage,commission_per_visit,commission_type,created_at',
  patient_auth: 'id,patient_id,location_id,username,email,phone,is_verified,created_at,updated_at,supabase_user_id',
};

async function rest(path: string, method='GET', body?: unknown, headers: Record<string,string>={}) {
  const response = await fetch(`${restBase}/${path}`, {
    method, headers: { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (Deno.env.get('AUTH_REHEARSAL_DIAGNOSTICS') === 'true') {
      const diagnostic = await response.json().catch(() => ({}));
      console.error(`Rehearsal database status ${response.status}, code ${diagnostic.code || 'unknown'}`);
    }
    throw new Error('Database operation failed');
  }
  return response;
}
async function rpc(name: string, body: unknown) {
  const text=await (await rest(`rpc/${name}`,'POST',body)).text();
  return text ? JSON.parse(text) : null;
}
async function rows(table:string, query:string) { return (await rest(`${table}?${query}`)).json(); }
const eq = (value:string) => encodeURIComponent(`eq.${value}`);
const email = (value:unknown) => String(value || '').trim().toLowerCase();
const username = (value:unknown) => String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
function phone(value:unknown) {
  const digits=String(value || '').replace(/\D/g,'');
  let local=digits;
  if (digits.startsWith('95') && /^9\d{7,9}$/.test(digits.slice(2))) local='0'+digits.slice(2);
  else if (/^9\d{7,9}$/.test(digits)) local='0'+digits;
  return /^09\d{7,9}$/.test(local) ? local : digits.length>=7 ? digits : null;
}
async function digest(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))
    .map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function checkPassword(password:string,row:any) {
  if (row.password_scheme === 'argon2id-trim-v1') return verifyPassword(password.trim(),row.password);
  return verifyPassword(password,row.password);
}
function publicRow(table:string,row:any) {
  return Object.fromEntries(safeColumns[table].split(',').filter(k=>k in row).map(k=>[k,row[k]]));
}
async function session(token:unknown) {
  if (typeof token!=='string' || !/^[0-9a-f-]{36}$/.test(token)) return null;
  return rpc('secure_auth_validate',{p_token:token});
}
async function sendCode(address:string,purpose:'signup'|'reset',origin:string) {
  const code=purpose==='signup'
    ? String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000)
    : Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');
  await rpc('secure_auth_code',{p_email:address,p_purpose:purpose,p_digest:await digest(code)});
  const text=purpose==='signup' ? `Your patient signup code is ${code}. It expires in 20 minutes.`
    : `Reset your password: ${origin}/?reset=password&email=${encodeURIComponent(address)}&code=${code}\nThis link expires in 20 minutes.`;
  const response=await fetch(Deno.env.get('AUTH_EMAIL_ENDPOINT') || 'https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('RESEND_API_KEY')}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:`DentalCloud <${Deno.env.get('RESEND_FROM_EMAIL')}>`,to:[address],subject:purpose==='signup'?'Patient signup code':'Reset your password',text}),
  });
  if (!response.ok) throw new Error('Email delivery unavailable');
}

Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const reply=(data:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json',...extra}});
  if(req.method!=='POST') return reply({error:'Method not allowed'},405);
  try {
    const raw=await req.text();
    if(raw.length>65536) return reply({error:'Request too large'},413);
    const b=JSON.parse(raw);
    const action=String(b.action || '');
    if(!['validate','logout'].includes(action) && (!await rpc('secure_auth_ready',{}) || !await rpc('secure_auth_converted',{}))) {
      return reply({error:'Secure login upgrade is in progress. Please try again shortly.'},503);
    }
    const identity=username(b.identifier || b.email || '');
    const remote=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limitKey=await digest(`${action}:${remote}:${action==='mutate' || action==='validate' ? String(b.token || '') : identity}`);
    if(!await rpc('secure_auth_limit',{p_key:limitKey,p_limit:action==='login'?60:30,p_seconds:300}))
      return reply({error:'Too many attempts. Please wait and try again.'},429);

    if(action==='login') {
      const password=String(b.password || '');
      if(!identity || !password) return reply({user:null});
      if(b.kind==='staff') {
        let candidates=await rows('users',`select=*&username=ilike.${encodeURIComponent(String(b.identifier).trim().replace(/[\\%_]/g,'\\$&'))}`);
        // Preserve doctor email fallback, but verification and token issuance stay server-side.
        if(!candidates.length) {
          const doctors=await rows('doctors',`select=*&email=${eq(email(b.identifier))}`);
          if(doctors[0]) candidates=await rows('users',`select=*&doctor_id=${eq(doctors[0].id)}`);
        }
        if(new Set(candidates.map((r:any)=>r.id)).size>1) return reply({error:'Ambiguous username. Please contact the clinic administrator.'});
        for(const row of candidates) if(await checkPassword(password,row)) {
          const token=await rpc('secure_auth_session',{p_kind:'staff',p_id:row.id,p_hash:row.password});
          return reply({user:{...publicRow('users',row),auth_session_token:token}});
        }
        const doctors=await rows('doctors',`select=*&email=${eq(email(b.identifier))}`);
        for(const doctor of doctors) if(await checkPassword(password,doctor)) {
          const linked=(await rows('users',`select=*&doctor_id=${eq(doctor.id)}`))[0];
          if(!linked) continue;
          const token=await rpc('secure_auth_session',{p_kind:'staff',p_id:linked.id,p_hash:linked.password});
          return reply({user:{...publicRow('users',linked),auth_session_token:token}});
        }
        return reply({user:null});
      }
      // Exact legacy patient matching, with normalized phone fallback and duplicate support.
      const all=[];
      for(let offset=0;;offset+=500) {
        const page=await rows('patient_auth',`select=*&order=is_verified.desc,created_at.desc,id&limit=500&offset=${offset}`);
        all.push(...page);
        if(page.length<500) break;
      }
      const matches=all.filter((r:any)=>r.email===identity || r.username===identity || r.phone===String(b.identifier).trim()
        || (phone(b.identifier)!==null && phone(r.phone)===phone(b.identifier)));
      let candidates=matches;
      if(!candidates.length) {
        const exact=String(b.identifier).trim();
        const named=await rows('patients',`select=id,name,phone,patient_unique_id&name=${eq(exact)}`);
        const numbered=await rows('patients',`select=id,name,phone,patient_unique_id&patient_unique_id=${eq(exact)}`);
        const patients=[...named,...numbered];
        if(phone(b.identifier)) {
          for(let offset=0;;offset+=500) {
            const page=await rows('patients',`select=id,name,phone,patient_unique_id&order=id&limit=500&offset=${offset}`);
            patients.push(...page.filter((p:any)=>phone(p.phone)===phone(b.identifier)));
            if(page.length<500) break;
          }
        }
        const ids=patients.filter((p:any)=>p.name===String(b.identifier).trim()
          || p.patient_unique_id===String(b.identifier).trim()
          || (phone(b.identifier)!==null && phone(p.phone)===phone(b.identifier))).map((p:any)=>p.id);
        candidates=all.filter((r:any)=>ids.includes(r.patient_id));
      }
      const verifiedCandidates=[];
      for(const row of candidates) if(row.is_verified!==false && await checkPassword(password,row)) verifiedCandidates.push(row);
      if(new Set(verifiedCandidates.map((r:any)=>r.patient_id)).size>1) {
        return reply({error:'This phone number is shared by multiple accounts. Please use your username, email, or full name.'});
      }
      for(const row of verifiedCandidates) {
        const patient=(await rows('patients',`select=*&id=${eq(row.patient_id)}`))[0];
        if(!patient) continue;
        const token=await rpc('secure_auth_session',{p_kind:'patient',p_id:row.patient_id,p_hash:row.password});
        return reply({patient,token});
      }
      return reply({patient:null});
    }
    if(action==='validate') return reply({session:await session(b.token)});
    if(action==='logout') { await rpc('secure_auth_revoke',{p_token:String(b.token || '')}); return reply({success:true}); }

    if(['signup','resend','reset-request','verify-signup','reset-complete'].includes(action)) {
      const address=email(b.email);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return reply({error:'Please enter a valid email address.'});
      const origin=req.headers.get('origin') || '';
      const allowed=(Deno.env.get('AUTH_ALLOWED_ORIGINS') || 'https://mydentist.dentalcloud.asia').split(',');
      if(!allowed.includes(origin)) return reply({error:'Unrecognized application origin'},403);
      const existing=(await rows('patient_auth',`select=*&email=${eq(address)}`))[0];
      if(action==='reset-request') {
        if(existing) await sendCode(address,'reset',origin);
        return reply({success:true,message:'If that email is registered, password reset instructions have been sent.'});
      }
      if(action==='verify-signup' || action==='reset-complete') {
        const purpose=action==='verify-signup'?'signup':'reset';
        const password=String(b.password || '');
        if(purpose==='reset' && password.length<6) return reply({error:'Password must be at least 6 characters long.'});
        const success=await rpc('secure_auth_complete',{p_email:address,p_purpose:purpose,
          p_digest:await digest(String(b.code || '')),p_hash:purpose==='reset'?await hashPassword(password):null});
        return reply({success,message:success?'Completed successfully. Please log in.':'Code is invalid, expired, or already used.',email:address});
      }
      if(existing?.is_verified!==false && existing) return reply({error:'This email is already registered. Please log in.'});
      if(action==='signup') {
        const password=String(b.password || '');
        if(password.length<6) return reply({error:'Password must be at least 6 characters long.'});
        const hash=await hashPassword(password);
        if(existing) {
          // Never replace a pending account's password without email proof.
          await sendCode(address,'signup',origin);
          return reply({success:true,message:'Signup code sent.'});
        }
        const profile=b.profile || {};
        const loginName=username(profile.username);
        if(loginName && (await rows('patient_auth',`select=id&username=${eq(loginName)}`)).length)
          return reply({error:'Username is already registered.'});
        const location=(await rows('locations','select=id&limit=1'))[0];
        if(!location) throw new Error('No clinic location');
        // Do not attach a public signup to an existing clinical record without verified ownership.
        const patient=(await (await rest('patients','POST',{
          name:loginName || address.split('@')[0],email:address,phone:profile.phone || null,
          location_id:location.id,age:profile.age ?? null,address:profile.address || null,
          city:profile.city || null,township:profile.township || null,
        },{Prefer:'return=representation'})).json())[0];
        try {
          await rest('patient_auth','POST',{patient_id:patient.id,location_id:patient.location_id,
            email:address,username:loginName || null,phone:profile.phone || null,is_verified:false,
            password:hash,password_scheme:'argon2id-exact-v1'});
        } catch(error) { await rest(`patients?id=${eq(patient.id)}`,'DELETE'); throw error; }
      }
      if(action==='resend' && !existing) return reply({error:'Pending signup not found.'});
      await sendCode(address,'signup',origin);
      return reply({success:true,message:'Signup code sent.'});
    }

    if(action==='mutate') {
      const actor=await session(b.token);
      const table=String(b.table || '');
      const method=String(b.method || '');
      if(!actor || !safeColumns[table] || !['POST','PATCH','DELETE'].includes(method)) return reply({error:'Sign in required'},401);
      const params=new URLSearchParams(String(b.query || ''));
      const payload=b.payload;
      if(Array.isArray(payload) || (method!=='DELETE' && (!payload || typeof payload!=='object'))) return reply({error:'Invalid account request'},400);
      const writable = safeColumns[table].split(',').filter(k=>!['id','created_at'].includes(k)).concat('password');
      if(payload && Object.keys(payload).some(k=>!writable.includes(k))) return reply({error:'Invalid account fields'},400);
      if(actor.kind==='patient') {
        if(table!=='patient_auth' || method!=='PATCH' || params.get('patient_id')!==`eq.${actor.id}`
          || Object.keys(payload).some(k=>!['password','updated_at'].includes(k))) return reply({error:'Permission denied'},403);
      } else if(table!=='patient_auth' && actor.role!=='admin') return reply({error:'Administrator permission required'},403);
      else if(table==='patient_auth' && actor.doctor_id) return reply({error:'Staff permission required'},403);
      for(const k of params.keys()) if(!['id','patient_id','email','doctor_id','select','on_conflict'].includes(k)) return reply({error:'Invalid query'},400);
      if(actor.kind==='patient' && [...params.keys()].some(k=>!['patient_id','select'].includes(k))) return reply({error:'Permission denied'},403);
      if(method!=='POST' && !['id','patient_id','email','doctor_id'].some(k=>params.get(k)?.startsWith('eq.'))) return reply({error:'An exact account filter is required'},400);
      // Explicit safe return columns: select=* must never return a hash.
      params.set('select',safeColumns[table]);
      if(payload && 'password' in payload) {
        if(payload.password===null && method==='POST' && actor.kind==='staff') {
          payload.password_scheme=null;
        } else {
        const password=String(payload.password || '');
        if(!password) return reply({error:'Password cannot be empty'},400);
        payload.password=await hashPassword(password);
        payload.password_scheme='argon2id-exact-v1';
        }
      } else if(payload && 'password_scheme' in payload) return reply({error:'Invalid credential state'},400);
      const headers:Record<string,string>={};
      if(b.prefer) headers.Prefer=String(b.prefer);
      if(b.accept) headers.Accept=String(b.accept);
      const response=await rest(`${table}?${params}`,method,method==='DELETE'?undefined:payload,headers);
      return new Response(response.status===204 ? null : await response.text(),{status:response.status,headers:{...cors,
        'Content-Type':response.headers.get('content-type') || 'application/json',
        ...(response.headers.get('content-range')?{'Content-Range':response.headers.get('content-range')!}:{})}});
    }
    return reply({error:'Unknown action'},400);
  } catch (error) {
    // Deliberately suppress error messages; runtime errors can contain URLs/tokens.
    // No request body, password, code, hash, token, or database error in logs.
    return reply({error:'Secure authentication is temporarily unavailable. Please try again.'},503);
  }
});