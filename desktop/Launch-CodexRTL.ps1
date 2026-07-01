$ErrorActionPreference = "Stop"

$port = if ($env:CODEX_RTL_PORT) { $env:CODEX_RTL_PORT } else { "9223" }
if (-not ($port -match '^\d+$') -or [int]$port -lt 1024 -or [int]$port -gt 65535) {
  Write-Error "CODEX_RTL_PORT must be an integer between 1024 and 65535."
}

$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue

if (-not $package) {
  Write-Error "OpenAI Codex Windows package was not found."
}

$exe = Join-Path $package.InstallLocation "app\Codex.exe"

if (-not (Test-Path $exe)) {
  Write-Error "Could not find Codex.exe at $exe"
}

$running = Get-Process -Name Codex -ErrorAction SilentlyContinue
if ($running) {
  Write-Error "Codex is already running. Close it first, then run this launcher again so the debugging port is enabled."
}

Write-Host "Starting Codex with local DevTools port $port..."
Start-Process -FilePath $exe -ArgumentList "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=$port"
Write-Host "Codex started. Keep it open, then run: npm run inject"
