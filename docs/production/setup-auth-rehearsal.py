"""Runs ON THE SERVER. Builds an isolated auth stack; never prints secrets."""
import json
import os
import subprocess
from urllib.parse import urlsplit, urlunsplit

ROOT = '/root/password-security-rehearsal-20261002'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs).stdout

def env(container):
    data = json.loads(run('docker', 'inspect', container))[0]
    return dict(item.split('=', 1) for item in data['Config']['Env'] if '=' in item)

os.umask(0o077)
existing = run('docker', 'network', 'ls', '--format', '{{.Name}}').decode().splitlines()
if 'dental-auth-rehearsal' not in existing:
    run('docker', 'network', 'create', '--internal', 'dental-auth-rehearsal')
run('docker', 'network', 'connect', 'dental-auth-rehearsal', 'dental-password-rehearsal')

settings = env('supabase-rest')
uri = urlsplit(settings['PGRST_DB_URI'])
settings['PGRST_DB_URI'] = urlunsplit((uri.scheme, 'postgres@dental-password-rehearsal:5432', uri.path, '', ''))
# The private rehearsal network has no published ports. Production network unchanged.
sql = "ALTER SYSTEM SET listen_addresses='*'; SELECT pg_reload_conf();"
run('docker', 'exec', '-i', 'dental-password-rehearsal', 'psql', '-X', '-h', '/tmp', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', input=sql.encode())
run('docker', 'restart', 'dental-password-rehearsal')

path = ROOT + '/rehearsal-rest.env'
with open(path, 'w') as f:
    for k, v in settings.items():
        if k.startswith('PGRST_'):
            f.write(k + '=' + v + '\n')
run('docker', 'run', '-d', '--name', 'dental-auth-rest', '--network', 'dental-auth-rehearsal',
    '--memory', '256m', '--cpus', '1', '--env-file', path, 'postgrest/postgrest:v14.12')

edge = env('supabase-edge-functions')
edge['SUPABASE_URL'] = 'http://dental-auth-rest:3000'
edge['AUTH_ALLOWED_ORIGINS'] = 'https://rehearsal.invalid'
edge['AUTH_EMAIL_ENDPOINT'] = 'http://dental-auth-email:9000'
path = ROOT + '/rehearsal-edge.env'
with open(path, 'w') as f:
    for k in ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
              'AUTH_ALLOWED_ORIGINS', 'AUTH_EMAIL_ENDPOINT']:
        if k in edge:
            f.write(k + '=' + edge[k] + '\n')
run('docker', 'run', '-d', '--name', 'dental-auth-edge', '--network', 'dental-auth-rehearsal',
    '--memory', '512m', '--cpus', '1', '--env-file', path,
    '-v', ROOT + '/runtime-cache:/root/.cache/deno:ro',
    'supabase/edge-runtime:v1.74.0', 'start', '--main-service', '/root/.cache/deno/credential-auth.eszip')
print('ISOLATED_AUTH_STACK_STARTED')