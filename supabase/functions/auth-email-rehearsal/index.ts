// Rehearsal only. Never sends email or logs signup/reset tokens.
Deno.serve(async req => {
  const payload=await req.json();
  if(!payload.to?.length || !payload.text) return Response.json({error:'Invalid email'}, {status:400});
  return Response.json({id:'synthetic-delivery'});
});