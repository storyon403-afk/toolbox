param([ValidateSet('build','test','run')][string]$Action = 'run')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE)" }
}
if ($Action -eq 'build') {
    Invoke-Checked 'cargo' @('build','--locked','--release','--workspace')
    Invoke-Checked 'npm.cmd' @('ci','--prefix','windows')
    Invoke-Checked 'node' @('windows/node_modules/electron/install.js')
} elseif ($Action -eq 'test') {
    Invoke-Checked 'cargo' @('fmt','--all','--','--check')
    Invoke-Checked 'cargo' @('clippy','--workspace','--all-targets','--','-D','warnings')
    Invoke-Checked 'cargo' @('test','--workspace')
    Invoke-Checked '.\backend\.venv\Scripts\python.exe' @('-m','unittest','discover','-s','backend/worker/tests','-v')
    Invoke-Checked 'node' @('--test','windows/ui/logic.test.mjs','windows/protocol.test.cjs','windows/settings.test.cjs')
    $env:LINKPARSING_PYTHON = (Resolve-Path '.\backend\.venv\Scripts\python.exe').Path
    Invoke-Checked 'cargo' @('test','--workspace','--test','media_smoke','--','--ignored')
    Invoke-Checked 'cargo' @('test','--workspace','--test','download_flow','--','--ignored')
} else {
    if (-not (Test-Path 'target\release\linkparsing-desktop.exe')) { throw 'Run: .\scripts\windows.ps1 build' }
    Invoke-Checked 'npm.cmd' @('start','--prefix','windows')
}
