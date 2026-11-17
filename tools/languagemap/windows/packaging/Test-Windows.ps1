$ErrorActionPreference = 'Stop'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('LanguageMap-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$app = Join-Path $PSScriptRoot 'app\LanguageMap.exe'
foreach ($test in @('fresh.js','smoke.js','reopen.js','quit.js','after-quit.js')) {
 $script = Join-Path $PSScriptRoot "tests\$test"
 $result = Join-Path $directory 'test-result.json'
 if (Test-Path $result) { Remove-Item -LiteralPath $result }
 $process = Start-Process -FilePath $app -ArgumentList @('--self-test',"`"$directory`"","`"$script`"") -PassThru
 if (-not $process.WaitForExit(90000)) {
  throw "Test $test timed out. Close the test window normally. Temporary profile: $directory"
 }
 if (-not (Test-Path $result)) { throw "Test $test did not report a result (exit $($process.ExitCode))." }
 $report = Get-Content -LiteralPath $result -Raw -Encoding UTF8 | ConvertFrom-Json
 if ($process.ExitCode -ne 0 -or -not $report.ok) { throw ($report | ConvertTo-Json -Depth 10) }
 Write-Host "PASS: $test - $($report.result)"
 $image = Join-Path $directory 'screenshot.png'
 if (Test-Path $image) { Copy-Item -LiteralPath $image -Destination (Join-Path $directory "$test.png") }
}
Write-Host "All native Windows smoke tests passed. Test-only data: $directory"
