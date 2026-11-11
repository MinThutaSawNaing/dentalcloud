param([string]$PgBin = 'C:\Program Files\PostgreSQL\15\bin')
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('auto-opt-' + [guid]::NewGuid().ToString('N'))
$data = Join-Path $root 'data'
$port = 55439
$started = $false
function Invoke-Pg([string]$exe, [string[]]$arguments) {
    & (Join-Path $PgBin $exe) @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed: $LASTEXITCODE" }
}
try {
    New-Item -ItemType Directory $root | Out-Null
    Invoke-Pg 'initdb.exe' @('-D', $data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8')
    # Only loopback, new random data directory; never use an existing server/URL.
    Invoke-Pg 'pg_ctl.exe' @('-D', $data, '-l', (Join-Path $root 'server.log'), '-o', "-h 127.0.0.1 -p $port", '-w', 'start')
    $started = $true
    $conn = @('-X','-h','127.0.0.1','-p',"$port",'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1')
    Invoke-Pg 'psql.exe' ($conn + @('-f', (Join-Path $PSScriptRoot 'auto-opt-postgres.sql')))
    # Concurrent FK inserts must serialize without deadlocking or double conversion.
    $a = Join-Path $root 'a.sql'
    $b = Join-Path $root 'b.sql'
    "SET TIME ZONE 'Asia/Yangon'; SET statement_timeout = '15s'; SET ROLE anon; BEGIN; INSERT INTO treatments(patient_id) VALUES (lpad('7',32,'0')::uuid); SELECT pg_sleep(2); COMMIT;" | Set-Content $a
    "SET TIME ZONE 'Asia/Yangon'; SET statement_timeout = '15s'; SET ROLE authenticated; BEGIN; INSERT INTO appointments(patient_id,date,status) VALUES (lpad('7',32,'0')::uuid,CURRENT_DATE,'Completed'); COMMIT;" | Set-Content $b
    $exe = Join-Path $PgBin 'psql.exe'
    $job = Start-Job -ScriptBlock { param($exe,$conn,$a) & $exe @conn -f $a; if ($LASTEXITCODE -ne 0) { throw 'concurrent session A failed' } } -ArgumentList $exe,$conn,$a
    Start-Sleep -Milliseconds 500
    Invoke-Pg 'psql.exe' ($conn + @('-f',$b))
    $job | Wait-Job | Receive-Job -ErrorAction Stop
    Remove-Job $job
    Invoke-Pg 'psql.exe' ($conn + @('-c',"SELECT assert_type(7,'OPT(ONP)');"))
    Write-Host 'Auto OPT PostgreSQL regression tests passed.'
} finally {
    if ($started) { & (Join-Path $PgBin 'pg_ctl.exe') -D $data -m immediate -w stop }
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
