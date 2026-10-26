# Signs a smoke-identity MSIX with a throwaway self-signed cert, installs it, launches in demo mode, screenshots.
param([Parameter(Mandatory)][string]$Msix, [Parameter(Mandatory)][string]$Subject, [Parameter(Mandatory)][string]$PackageName, [Parameter(Mandatory)][string]$OutDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cert = New-SelfSignedCertificate -Type Custom -Subject $Subject -KeyUsage DigitalSignature -FriendlyName 'MeetingPlz smoke' `
  -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $env:RUNNER_TEMP 'smoke.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $Msix
if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }

Add-AppxPackage -Path $Msix
$pkg = Get-AppxPackage -Name $PackageName
if (-not $pkg) { throw 'package not installed' }
Write-Host "Installed $($pkg.PackageFullName) at $($pkg.InstallLocation)"
$pkg | Format-List Name, Publisher, Version, Architecture, SignatureKind, Status | Out-String | Write-Host

# launch through the app execution alias: gets package identity and inherits this process environment
$alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\MeetingPlz.exe'
Write-Host "alias exists: $(Test-Path $alias)"
$env:MEETINGPLZ_DEMO = '1'
$env:MEETINGPLZ_DEBUG = '1'
Start-Process -FilePath $alias
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Start-Sleep -Seconds 5;  Shot 'win-msix-early.png'
Start-Sleep -Seconds 9;  Shot 'win-msix.png'
$procs = Get-Process MeetingPlz -ErrorAction SilentlyContinue
Write-Host "Process alive: $([bool]$procs)"
$procs | Select-Object Name, Id, Path | Format-Table | Out-String | Write-Host
Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages\$($pkg.PackageFamilyName)") -Recurse -Filter debug.log -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "--- $($_.FullName)"; Get-Content $_.FullName | Write-Host; Copy-Item $_.FullName (Join-Path $OutDir 'debug-msix.log') }
Stop-Process -Name MeetingPlz -Force -ErrorAction SilentlyContinue
if (-not $procs) { throw 'MeetingPlz did not start from the MSIX' }
