param(
    [ValidateSet('LAN', 'Tunnel')][string]$Mode = 'LAN',
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [string]$PublicUrl = ''
)
$ErrorActionPreference = 'Stop'
$binary = Join-Path $PSScriptRoot 'pangzhu.exe'
$dataFolder = Join-Path $PSScriptRoot 'data'
$serverProcess = $null
try {
    if (-not (Test-Path $binary)) { throw 'Extract the complete Windows package before launching.' }
    $listenAddress = '127.0.0.1'
    if ($Mode -eq 'LAN') {
        $listenAddress = '0.0.0.0'
        $adapter = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
        if ($adapter -and -not $PublicUrl) {
            $PublicUrl = 'http://{0}:{1}' -f $adapter.IPv4Address[0].IPAddress, $Port
        }
        Write-Host 'Allow Pangzhu on your trusted Private network when Windows Firewall asks.'
        Write-Host 'If blocked, run Enable-LAN.ps1 in an Administrator PowerShell window.'
    } elseif (-not $PublicUrl) {
        $PublicUrl = Read-Host 'Enter the HTTPS origin of your configured named tunnel (https://review.example.com)'
    }
    if ($PublicUrl) {
        $uri = $null
        if (-not [Uri]::TryCreate($PublicUrl, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
            $uri.AbsolutePath -ne '/' -or $PublicUrl.Contains('"')) {
            throw 'PublicUrl must be an HTTP(S) origin, without a path, credentials, query or fragment.'
        }
        if ($Mode -eq 'Tunnel' -and $uri.Scheme -ne 'https') { throw 'Use an HTTPS named tunnel origin.' }
        Write-Host ('Review URL: {0}/review' -f $PublicUrl.TrimEnd('/'))
    }
    # Refuse an occupied port instead of opening an unrelated service as the author.
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($listenAddress), $Port)
    try { $probe.Start() } finally { $probe.Stop() }
    $arguments = @('--host', $listenAddress, '--port', "$Port", '--data-dir', ('"{0}"' -f $dataFolder))
    if ($PublicUrl) { $arguments += @('--public-url', ('"{0}"' -f $PublicUrl)) }
    $serverProcess = Start-Process -FilePath $binary -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($serverProcess.HasExited) { throw ('Server exited with code {0}.' -f $serverProcess.ExitCode) }
        try {
            $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/review/api/state" -TimeoutSec 1
            if ($state.versions.Count -gt 0) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Server startup timed out.' }
    Start-Process "http://127.0.0.1:$Port/"
    Write-Host 'Keep this window open. Press Ctrl+C to stop. Data is saved in the data folder.'
    if ($Mode -eq 'Tunnel') { Write-Host 'The named cloudflared tunnel must be running separately (preferably as a Windows service).' }
    while (-not $serverProcess.HasExited) { Start-Sleep -Milliseconds 500 }
    if ($serverProcess.ExitCode -ne 0) { throw ('Server exited with code {0}.' -f $serverProcess.ExitCode) }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        # Updated versions run below the original launcher. Reap its entire tree.
        & taskkill.exe /PID $serverProcess.Id /T /F | Out-Null
    }
}
