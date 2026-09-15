# Daily backup of the studio's database running in Docker (docker-compose.yml).
#
# A complete, restorable copy — structure and data — in PostgreSQL's compressed
# custom format, written to local-backup\docker\ (git-ignored) and kept 14 days.
# Run by the scheduled task "NEON database backup"; safe to run by hand.
#
# To restore into the running container (replaces what is there):
#   docker cp <file> neon-db:/tmp/restore.dump
#   docker exec neon-db pg_restore -U neon -d neon --clean --if-exists /tmp/restore.dump
#
# These copies protect against mistakes and a damaged database, not against
# losing the PC: they sit on the same disk. Keep a copy somewhere else too.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root 'local-backup\docker'
$log  = Join-Path $dir 'backup.log'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

try {
  $stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
  $file  = Join-Path $dir "neon-$stamp.dump"
  $partial = "$file.partial"

  # Dumped inside the container and copied out, never piped: Windows PowerShell
  # treats a pipe as text and would corrupt the binary format.
  & docker exec neon-db pg_dump -U neon -d neon --format=custom --file=/tmp/neon-backup.dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed inside neon-db (exit $LASTEXITCODE)" }
  & docker cp neon-db:/tmp/neon-backup.dump $partial
  if ($LASTEXITCODE -ne 0) { throw "could not copy the backup out of neon-db (exit $LASTEXITCODE)" }
  & docker exec neon-db rm -f /tmp/neon-backup.dump | Out-Null

  # Renamed only once complete, so a backup cut off halfway is never mistaken
  # for a good one.
  Move-Item -Force $partial $file

  Get-ChildItem $dir -Filter 'neon-*.dump' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item -Force
  Get-ChildItem $dir -Filter '*.partial' | Remove-Item -Force -ErrorAction SilentlyContinue

  $line = "{0}  ok      {1} ({2} KB)" -f (Get-Date -Format 's'), (Split-Path -Leaf $file), [math]::Round((Get-Item $file).Length / 1KB)
  Add-Content -Path $log -Value $line
  $line
} catch {
  $line = "{0}  FAILED  {1}" -f (Get-Date -Format 's'), $_.Exception.Message
  Add-Content -Path $log -Value $line
  Write-Error $line
  exit 1
}
