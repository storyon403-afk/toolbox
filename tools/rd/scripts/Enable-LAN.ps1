#Requires -RunAsAdministrator
param([ValidateRange(1, 65535)][int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path (Join-Path $PSScriptRoot 'pangzhu.exe')).Path
$selected = & $launcher --executable-path
if ($LASTEXITCODE -ne 0 -or -not $selected) { throw 'Cannot resolve the installed Pangzhu executable.' }
$binary = (Resolve-Path -LiteralPath $selected).Path
$ruleName = "Pangzhu-Private-LAN-$Port"
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Set-NetFirewallRule -Name $ruleName -Enabled True -Profile Private -Direction Inbound -Action Allow
    $existing | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $binary
    $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
    $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
} else {
    New-NetFirewallRule -Name $ruleName -DisplayName "Pangzhu Private LAN ($Port)" -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Program $binary | Out-Null
}
Write-Host "Enabled port $Port for Pangzhu on Private networks, LocalSubnet only."
Write-Host "Undo: Remove-NetFirewallRule -Name '$ruleName'"
