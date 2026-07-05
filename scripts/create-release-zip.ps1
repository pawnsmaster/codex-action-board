$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$name = "$($package.name)-v$($package.version)"
$dist = Join-Path $root "dist"
$stage = Join-Path $dist $name
$zip = Join-Path $dist "$name.zip"
$sha = Join-Path $dist "$name.zip.sha256"

function Assert-Inside($path, $parent) {
  $resolvedParent = [System.IO.Path]::GetFullPath($parent)
  $resolvedPath = [System.IO.Path]::GetFullPath($path)
  if (-not $resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside release directory: $resolvedPath"
  }
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

Assert-Inside $stage $dist
Assert-Inside $zip $dist
Assert-Inside $sha $dist

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}
if (Test-Path $sha) {
  Remove-Item -LiteralPath $sha -Force
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null

$files = @(
  ".gitattributes",
  ".gitignore",
  "LICENSE",
  "README.md",
  "Run-CodexActionBoard.cmd",
  "Run-CodexActionBoard-Arabic.cmd",
  "SECURITY.md",
  "SECURITY_AUDIT.md",
  "package.json",
  "package-lock.json"
)

$directories = @(
  "desktop",
  "docs",
  "extension",
  "scripts",
  "src",
  "tests"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file)
}

foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $stage $directory) -Recurse
}

$blocked = @(".git", ".tools", "node_modules", "dist")
foreach ($entry in $blocked) {
  if (Test-Path (Join-Path $stage $entry)) {
    throw "Release staging unexpectedly contains $entry"
  }
}

Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zip
$hash.Hash | Set-Content -NoNewline -Encoding ASCII -Path $sha

Write-Host "Created $zip"
Write-Host "SHA256 $($hash.Hash)"
