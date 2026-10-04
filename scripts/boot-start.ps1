# Make the site come back by itself when this PC is switched on.
#
# Run once, as administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\boot-start.ps1
#
# Docker Desktop cannot run until an account is signed in - it is a desktop
# application, and its engine is started by it. Everything else was already in
# place (Docker Desktop starts at sign-in, every container restarts on its own,
# the PC never sleeps). What was missing is the sign-in: on 2026-10-03 the PC sat
# at the sign-in screen for 6, 12 and 14 minutes after three of its boots, with
# the site down the whole time, because automatic sign-in was switched on with
# no password stored for it.
#
# So this script:
#   1. allows signing in with the password, which automatic sign-in needs
#      ("Windows Hello only" refuses it);
#   2. switches off Fast Startup, so that switching on is a real boot - and so
#      step 3 can tell a boot from somebody signing in later;
#   3. adds a task that locks the screen when the sign-in comes within five
#      minutes of a boot - the automatic one - so the desk shows the lock screen
#      and still needs the PIN or password, while Docker carries on behind it;
#   4. opens Microsoft's Autologon (Sysinternals), where the Windows password is
#      typed once. It is kept as an LSA secret, encrypted - never in a file and
#      never on a command line.
#
# Everything here can be undone: Autologon -> Disable, Settings -> Accounts ->
# Sign-in options, `powercfg /hibernate on`, and deleting the task.

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Run this as administrator." -ForegroundColor Red
  exit 1
}

$dir = Join-Path $env:ProgramData "NEON"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Start-Transcript -Path (Join-Path $dir "boot-start.log") -Append | Out-Null

try {
  # 1. Password sign-in allowed again. 2 = Windows Hello only, 0 = not.
  $passwordless = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device"
  New-Item -Path $passwordless -Force | Out-Null
  Set-ItemProperty -Path $passwordless -Name DevicePasswordLessBuildVersion -Type DWord -Value 0
  Write-Host "1. Password sign-in allowed (needed for automatic sign-in)."

  # 2. Fast Startup off: a shutdown otherwise hibernates the kernel, and the
  #    uptime the lock task reads would not restart from zero.
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name HiberbootEnabled -Type DWord -Value 0
  Write-Host "2. Fast Startup off: switching on is now a real boot."

  # 3. Lock straight after the automatic sign-in, and only then - somebody
  #    signing in by hand later in the day is not locked out of their own desk.
  $user = "$env:COMPUTERNAME\$env:USERNAME"
  # The comma is quoted: unquoted, PowerShell reads `user32.dll,LockWorkStation`
  # as a two-item array, rundll32 gets them as two words, and nothing locks.
  $lock = "if (((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes -lt 5) { rundll32.exe 'user32.dll,LockWorkStation' }"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"$lock`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName "NEON lock after automatic sign-in" -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "3. The screen locks itself right after the automatic sign-in."

  # 4. Autologon, from Microsoft's own Sysinternals site, checked before running.
  $autologon = Join-Path $dir "Autologon64.exe"
  if (-not (Test-Path $autologon)) {
    Invoke-WebRequest -Uri "https://live.sysinternals.com/Autologon64.exe" -OutFile $autologon -UseBasicParsing
  }
  $signature = Get-AuthenticodeSignature $autologon
  if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Microsoft") {
    Remove-Item $autologon -Force
    throw "Autologon64.exe is not signed by Microsoft - not running it."
  }
  Write-Host "4. Opening Autologon. Type your WINDOWS PASSWORD (not the PIN) and press Enable."
  Start-Process -FilePath $autologon -ArgumentList "/accepteula" -Wait
  Write-Host ""
  Write-Host "Done. Restart the PC when the site can be down for two minutes, to check it." -ForegroundColor Green
}
finally {
  Stop-Transcript | Out-Null
}

Read-Host "Press Enter to close"
