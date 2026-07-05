$ErrorActionPreference = "Stop"

$files = @(
  "desktop\Launch-CodexActionBoard.ps1",
  "desktop\Run-CodexActionBoard.ps1"
)

foreach ($file in $files) {
  $path = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) $file
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    $messages = $errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }
    throw "$file has PowerShell parse errors:`n$($messages -join "`n")"
  }
}

Write-Host "OK: PowerShell scripts parse."
