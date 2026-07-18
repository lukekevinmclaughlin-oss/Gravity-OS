$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $repo "src-tauri"
$manifest = Join-Path $tauri "Cargo.toml"

# Tauri validates bundle resources before it links the application. On the GNU
# Windows target, WebView2Loader.dll is supplied by webview2-com-sys, but Cargo
# normally copies it beside the executable only after that validation point.
# Resolve the locked crate source first so clean release builds are reproducible.
$metadataJson = & cargo metadata --locked --format-version 1 --manifest-path $manifest
if ($LASTEXITCODE -ne 0) {
  throw "cargo metadata failed while locating WebView2Loader.dll."
}

$metadata = $metadataJson | ConvertFrom-Json
$webviewPackage = $metadata.packages |
  Where-Object { $_.name -eq "webview2-com-sys" } |
  Sort-Object { [version]$_.version } -Descending |
  Select-Object -First 1

if (-not $webviewPackage) {
  throw "The locked Cargo graph does not contain webview2-com-sys."
}

$architecture = switch -Regex ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { "arm64"; break }
  "^(x86|X86)$" { "x86"; break }
  default { "x64" }
}

$crateDirectory = Split-Path -Parent $webviewPackage.manifest_path
$source = Join-Path $crateDirectory "$architecture\WebView2Loader.dll"
$releaseDirectory = Join-Path $tauri "target\release"
$destination = Join-Path $releaseDirectory "WebView2Loader.dll"

if (-not (Test-Path -LiteralPath $source)) {
  throw "WebView2Loader.dll was not found for architecture '$architecture' at '$source'."
}

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Staged WebView2Loader.dll for $architecture from webview2-com-sys $($webviewPackage.version)."
