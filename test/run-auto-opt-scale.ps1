param([string]$PgBin = 'C:\Program Files\PostgreSQL\15\bin', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$preflight = Join-Path $repo 'database\auto_opt_patient_type_indexes.sql'
if (!(Test-Path $preflight)) { throw "Required parent-owned index preflight missing: $preflight" }
if (!$OutputDirectory) { $OutputDirectory = Join-Path ([IO.Path]::GetTempPath()) ('auto-opt-scale-' + [guid]::NewGuid().ToString('N')) }
$root = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path $root) { throw 'Output directory must be new (never reuse a cluster).' }
New-Item -ItemType Directory $root | Out-Null
$data = Join-Path $root 'data'
$serverLog = Join-Path $root 'server.log'
$started = $false
$jobs = @()
function Invoke-Pg([string]$exe, [string[]]$arguments) {
 $ErrorActionPreference = 'Continue' # Native NOTICE stderr is not a failing exit code in Windows PowerShell.
 & (Join-Path $PgBin $exe) @arguments
 if ($LASTEXITCODE -ne 0) { throw "$exe failed: $LASTEXITCODE" }
}
try {
 Start-Transcript -Path (Join-Path $root 'runner.log') | Out-Null
 # No durable data is retained: skip only initdb's startup fsync, not server fsync.
 Invoke-Pg 'initdb.exe' @('-D',$data,'-U','postgres','-A','trust','--no-locale','-E','UTF8','--no-sync')
 @"
listen_addresses = '127.0.0.1'
port = 55440
shared_buffers = '128MB'
work_mem = '4MB'
maintenance_work_mem = '64MB'
max_connections = 12
max_parallel_workers_per_gather = 0
shared_preload_libraries = 'auto_explain'
auto_explain.log_min_duration = -1
auto_explain.log_analyze = on
auto_explain.log_buffers = on
auto_explain.log_nested_statements = on
auto_explain.log_timing = off
log_line_prefix = '%a '
"@ | Add-Content (Join-Path $data 'postgresql.conf')
 Invoke-Pg 'pg_ctl.exe' @('-D',$data,'-l',$serverLog,'-w','start')
 $started = $true
 # Explicit local endpoint, fresh cluster, no URL or production credentials.
 $conn = @('-X','-h','127.0.0.1','-p','55440','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1')
 $vars = @('-v',('preflight='+$preflight.Replace('\','/')),'-v',('onp_migration='+(Join-Path $repo 'supabase\migrations\20260921000000_atomic_auto_onp_refresh.sql').Replace('\','/')),'-v',('opt_migration='+(Join-Path $repo 'supabase\migrations\20261111000000_auto_opt_patient_type.sql').Replace('\','/')))
 # Enable nested plans only after bulk load, to avoid millions of FK plans.
 # PGOPTIONS is local process environment only and is restored below.
 $oldOptions = $env:PGOPTIONS
 $env:PGOPTIONS = '-c auto_explain.log_min_duration=0'
 # SQL bulk-load section temporarily suppresses auto_explain itself.
 Invoke-Pg 'psql.exe' ($conn + $vars + @('-f',(Join-Path $PSScriptRoot 'auto-opt-scale.sql'))) *> (Join-Path $root 'scale.log')
 $env:PGOPTIONS = $oldOptions
 $a = Join-Path $root 'concurrent-a.sql'; $b = Join-Path $root 'concurrent-b.sql'
 $prefix = "SET TIME ZONE 'Asia/Yangon'; SET statement_timeout='15s'; SET lock_timeout='10s'; SET ROLE anon; SELECT set_config('scale.allowed_patient',scale_id(99999)::text,false);"
 "$prefix BEGIN; INSERT INTO treatments(patient_id,date) VALUES(scale_id(99999),CURRENT_DATE); SELECT pg_sleep(2); COMMIT;" | Set-Content $a
 "$prefix BEGIN; INSERT INTO appointments(patient_id,date,status) VALUES(scale_id(99999),CURRENT_DATE,'Completed'); COMMIT;" | Set-Content $b
 $exe = Join-Path $PgBin 'psql.exe'
 $watch = [Diagnostics.Stopwatch]::StartNew()
 $jobs += Start-Job -ScriptBlock { param($exe,$conn,$file,$log) & $exe @conn -f $file *> $log; if ($LASTEXITCODE -ne 0) { throw 'Concurrent A failed' } } -ArgumentList $exe,$conn,$a,(Join-Path $root 'concurrent-a.log')
 # Wait for A's inserted row lock, not job-process startup timing.
 $locked = $false
 for ($i=0; $i -lt 100; $i++) {
   $active = & $exe @conn -Atc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(2)%' AND state='active'"
   if ($active -eq '1') { $locked=$true; break }
   Start-Sleep -Milliseconds 100
 }
 if (!$locked) { throw 'Concurrent A did not reach hold point' }
 Invoke-Pg 'psql.exe' ($conn + @('-f',$b)) *> (Join-Path $root 'concurrent-b.log')
 $jobs | Wait-Job | Receive-Job -ErrorAction Stop
 $watch.Stop(); Write-Host "Concurrent pair elapsed ms: $($watch.ElapsedMilliseconds) (includes deliberate 2s lock hold and job startup)"
 Invoke-Pg 'psql.exe' ($conn + @('-c',('DO $$ BEGIN IF (SELECT count(*) FROM scale_patient_audit)<>3 OR (SELECT count(*) FROM scale_patient_audit WHERE id=scale_id(99999))<>1 OR (SELECT patient_type FROM patients WHERE id=scale_id(99999))<>''OPT(ONP)'' THEN RAISE EXCEPTION ''concurrency exact-one failed''; END IF; END $$;')))
 $log = Get-Content $serverLog -Raw
 $repeatBlocks = [regex]::Matches($log,'(?ms)^scale-already-converted LOG:.*?(?=^\S+ (?:LOG|ERROR|WARNING):|\z)')
 if ($repeatBlocks.Count -eq 0) { throw 'Missing nested already-converted plans' }
 if (($repeatBlocks.Value -join "`n") -match '(?im)(?:Index[^\r\n]*Scan|Seq Scan|Bitmap[^\r\n]*Scan)[^\r\n]*\bon (?:public\.)?(?:appointments|treatments)\b') { throw 'Already-converted visit scanned history' }
 if ($log -notmatch '(?s)scale-qualifying LOG:.*idx_appointments_auto_opt_visit') { throw 'Missing real trigger history index plan' }
 $historyBlocks = [regex]::Matches($log,'(?ms)^scale-(?:qualifying|history-miss|treatment-fallback) LOG:.*?(?=^\S+ (?:LOG|ERROR|WARNING|CONTEXT):|\z)') | Where-Object { $_.Value -match 'Query Text: EXISTS' }
 if ($historyBlocks.Count -ne 3) { throw 'Expected three real trigger history plans (hit, miss, treatment fallback)' }
 foreach ($block in $historyBlocks) {
   if ($block.Value -match 'Seq Scan on (?:public\.)?(appointments|treatments)') { throw 'Real trigger used large visit seqscan' }
   if ($block.Value -notmatch 'Index Cond:.*patient_id') { throw 'Real trigger history lookup not patient-bound' }
 }
 Write-Host 'PASS: anon RLS index hit/miss, zero enable touches, exact-one event, no repeat history lookup, concurrency.'
 Write-Host 'Local synthetic measurements only; NO production capacity guarantee.'
} finally {
 if (Test-Path variable:oldOptions) { $env:PGOPTIONS = $oldOptions }
 $jobs | Stop-Job -ErrorAction SilentlyContinue
 $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
 if ($started) { & (Join-Path $PgBin 'pg_ctl.exe') -D $data -m immediate -w stop }
 if (Test-Path $data) { Remove-Item -Recurse -Force $data }
 Write-Host "Retained logs: $root (disposable database removed)"
 try { Stop-Transcript | Out-Null } catch {}
}