Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
$issPath = Join-Path $desktopRoot 'installer\ReadHelperDesktop.iss'

& (Join-Path $PSScriptRoot 'build_exe.ps1')

if (-not (Test-Path $iscc)) {
    throw "Inno Setup compiler was not found at: $iscc"
}

Write-Host 'Building Windows installer with Inno Setup...'
& $iscc $issPath
Write-Host 'Installer build complete: dist\installer\ReadHelperDesktop-Setup.exe'
