# Installs the NSIS build silently, starts it in demo mode (test overlay after 3 s, no sign-in), screenshots the desktop.
param([string]$Installer, [string]$OutDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
$exe = Join-Path $env:LOCALAPPDATA 'MeetingPlz\MeetingPlz.exe'
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem -Path $env:LOCALAPPDATA, $env:ProgramFiles -Filter 'MeetingPlz.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.FullName } else { throw 'MeetingPlz.exe not found after install' }
}
Write-Host "Installed at $exe ($((Get-Item $exe).Length) bytes)"
$env:MEETINGPLZ_DEMO = '1'
$proc = Start-Process -FilePath $exe -PassThru
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Start-Sleep -Seconds 5;  Shot 'win-overlay-early.png'
Start-Sleep -Seconds 9;  Shot 'win-overlay.png'
Write-Host "Process alive: $(-not $proc.HasExited)"
Get-Process MeetingPlz -ErrorAction SilentlyContinue | Select-Object Name, Id, MainWindowTitle | Format-Table | Out-String | Write-Host
Stop-Process -Name MeetingPlz -Force -ErrorAction SilentlyContinue
$log = Join-Path $env:APPDATA 'com.dai.meetingplz.desktop\debug.log'
Write-Host '--- demo log'; if (Test-Path $log) { Get-Content $log | Write-Host; Copy-Item $log (Join-Path $OutDir 'debug-demo.log'); Remove-Item $log }
Start-Sleep -Seconds 2

# Signed-in settings window against the real API
Remove-Item Env:MEETINGPLZ_DEMO -ErrorAction SilentlyContinue
$env:MEETINGPLZ_TOKEN = $env:QA_TOKEN
$env:MEETINGPLZ_OPEN_SETTINGS = '1'
$env:MEETINGPLZ_DEBUG = '1'
$proc2 = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8; Shot 'win-settings.png'
Write-Host "Settings run alive: $(-not $proc2.HasExited)"
Stop-Process -Name MeetingPlz -Force -ErrorAction SilentlyContinue
Write-Host '--- settings log'; if (Test-Path $log) { Get-Content $log | Write-Host; Copy-Item $log (Join-Path $OutDir 'debug-settings.log') }
