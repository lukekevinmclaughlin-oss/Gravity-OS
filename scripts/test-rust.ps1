$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $repo "src-tauri"
$manifest = Join-Path $tauri "resources\common-controls.manifest"
$mt = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin\10.0.26100.0\x64\mt.exe"

if (-not (Test-Path -LiteralPath $mt)) {
  $mt = Get-ChildItem (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin") `
    -Recurse -Filter mt.exe -ErrorAction Stop |
    Where-Object { $_.FullName -match '\\x64\\mt\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

Push-Location $tauri
try {
  & cargo test --no-run
  if ($LASTEXITCODE -ne 0) { throw "cargo test --no-run failed with exit code $LASTEXITCODE" }

  $testHost = Get-ChildItem (Join-Path $tauri "target\debug\deps") `
    -Filter "gravity_os_lib-*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $testHost) { throw "Cargo did not produce the Gravity Rust test host." }

  # Tauri's release executable receives this activation context from its
  # resource pipeline. Rust's lib-test harness does not, so add the same
  # Common Controls v6 dependency before executing the harness.
  & $mt -nologo -manifest $manifest "-outputresource:$($testHost.FullName);#1"
  if ($LASTEXITCODE -ne 0) { throw "mt.exe failed with exit code $LASTEXITCODE" }

  $env:PATH = "$(Join-Path $tauri 'target\debug');$(Join-Path $tauri 'target\debug\deps');$env:PATH"
  & $testHost.FullName @args
  if ($LASTEXITCODE -ne 0) { throw "Rust tests failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
