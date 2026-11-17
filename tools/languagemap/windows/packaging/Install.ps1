$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'app'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\LanguageMap'
$data = Join-Path $env:LOCALAPPDATA 'LanguageMap'
if (-not (Test-Path (Join-Path $source 'LanguageMap.exe'))) { throw 'Extract the complete ZIP before running Install.cmd.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows 10 or 11.' }
$architecture = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'architecture.txt') -Raw).Trim()
if ($architecture -eq 'arm64' -and $env:PROCESSOR_ARCHITECTURE -ne 'ARM64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'ARM64') {
 throw 'This is the ARM64 package. Download the x64 package for an Intel/AMD computer.'
}
$running = Get-Process LanguageMap -ErrorAction SilentlyContinue
if ($running) { throw 'Please quit LanguageMap normally, then run Install.cmd again.' }

# Check documented WebView2 registry locations. Install only when missing.
$runtimeKeys = @(
 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
function Has-WebViewRuntime {
 foreach ($key in $runtimeKeys) {
  $version = (Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue).pv
  if ($version -and ([Version]$version).Major -ge 130) { return $true }
 }
 return $false
}
if (-not (Has-WebViewRuntime)) {
 $bootstrapper = Join-Path $PSScriptRoot 'MicrosoftEdgeWebview2Setup.exe'
 $signature = Get-AuthenticodeSignature -FilePath $bootstrapper
 if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
  throw 'The Microsoft WebView2 installer signature is invalid. Installation stopped.'
 }
 Write-Host 'Installing Microsoft WebView2 Runtime (internet access required)...'
 $setup = Start-Process -FilePath $bootstrapper -ArgumentList '/silent','/install' -Wait -PassThru
 if (-not (Has-WebViewRuntime)) { throw "WebView2 installation failed (exit $($setup.ExitCode)). Connect to the internet and run Install.cmd again." }
}

$parent = Split-Path $destination -Parent
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$staging = Join-Path $parent ('LanguageMap.install-' + [Guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $source -Destination $staging -Recurse
$previous = $null
try {
 if (Test-Path $destination) {
  $previous = "$destination.previous-$(Get-Date -Format yyyyMMdd-HHmmss)-$([Guid]::NewGuid().ToString('N').Substring(0,6))"
  Move-Item -LiteralPath $destination -Destination $previous
 }
 Move-Item -LiteralPath $staging -Destination $destination
} catch {
 if ($previous -and -not (Test-Path $destination)) { Move-Item -LiteralPath $previous -Destination $destination }
 throw
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'languagemap.cmd') -Destination $destination
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$entries = @($userPath -split ';' | Where-Object { $_ })
if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $destination.TrimEnd('\') })) {
 [Environment]::SetEnvironmentVariable('Path', (($entries + $destination) -join ';'), 'User')
}
# Notify Explorer so newly opened terminals inherit the updated user PATH.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LanguageMapEnvironment {
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);
}
'@
$result = [UIntPtr]::Zero
[void][LanguageMapEnvironment]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'LanguageMap.lnk'))
$shortcut.TargetPath = Join-Path $destination 'LanguageMap.exe'
$shortcut.WorkingDirectory = $destination
$shortcut.IconLocation = "$destination\LanguageMap.exe,0"
$shortcut.Save()
Write-Host "Installed: $destination"
Write-Host "Library:   $data"
Write-Host 'Open a new terminal and type: languagemap'
Start-Process -FilePath (Join-Path $destination 'LanguageMap.exe')
