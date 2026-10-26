# Builds an MSIX from the Tauri release exe.
# Usage: msix-build.ps1 -Exe <meetingplz.exe> -Icon <icon-1024.png> -Out <file.msix> -Name <identity> -Publisher <CN=...> -PublisherDisplayName <text> [-Version 1.0.0.0]
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$Icon,
  [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$Publisher,
  [Parameter(Mandatory)][string]$PublisherDisplayName,
  [string]$Version = '1.0.0.0'
)
$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:RUNNER_TEMP ("msix-" + [guid]::NewGuid().ToString('N'))
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item $Exe (Join-Path $stage 'MeetingPlz.exe')

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Icon))
function Save-Logo([string]$file, [int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  $s = [Math]::Min($w, $h)
  $g.DrawImage($src, [int](($w - $s) / 2), [int](($h - $s) / 2), $s, $s)
  $bmp.Save((Join-Path $assets $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Save-Logo 'StoreLogo.png' 50 50
Save-Logo 'Square44x44Logo.png' 44 44
Save-Logo 'Square71x71Logo.png' 71 71
Save-Logo 'Square150x150Logo.png' 150 150
Save-Logo 'Square310x310Logo.png' 310 310
Save-Logo 'Wide310x150Logo.png' 310 150
foreach ($t in 16, 24, 32, 48, 256) {
  Save-Logo "Square44x44Logo.targetsize-$t.png" $t $t
  Save-Logo "Square44x44Logo.targetsize-${t}_altform-unplated.png" $t $t
}
$src.Dispose()

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
         xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
         xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap uap3 uap5 desktop rescap">
  <Identity Name="$Name" Publisher="$Publisher" Version="$Version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>MeetingPlz</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="MeetingPlz" Executable="MeetingPlz.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="MeetingPlz"
                          Description="A meeting reminder you can't miss."
                          BackgroundColor="transparent"
                          Square150x150Logo="Assets\Square150x150Logo.png"
                          Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png"
                         Square71x71Logo="Assets\Square71x71Logo.png"
                         Square310x310Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <uap5:Extension Category="windows.startupTask" Executable="MeetingPlz.exe" EntryPoint="Windows.FullTrustApplication">
          <uap5:StartupTask TaskId="MeetingPlzStartup" Enabled="true" DisplayName="MeetingPlz" />
        </uap5:Extension>
        <uap3:Extension Category="windows.appExecutionAlias" Executable="MeetingPlz.exe" EntryPoint="Windows.FullTrustApplication">
          <uap3:AppExecutionAlias>
            <desktop:ExecutionAlias Alias="MeetingPlz.exe" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding($false)))

$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe not found' }
Write-Host "makeappx: $($makeappx.FullName)"
if (Test-Path $Out) { Remove-Item $Out -Force }
& $makeappx.FullName pack /d $stage /p $Out /nologo /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }
Write-Host "Built $Out ($((Get-Item $Out).Length) bytes) identity=$Name publisher=$Publisher"
