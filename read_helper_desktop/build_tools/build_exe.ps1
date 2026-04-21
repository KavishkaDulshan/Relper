Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$venvDir = Join-Path $desktopRoot '.venv'
$pythonExe = Join-Path $venvDir 'Scripts\python.exe'

& (Join-Path $PSScriptRoot 'sync_frontend.ps1')

if (-not (Test-Path $pythonExe)) {
    Write-Host 'Creating Python virtual environment...'
    python -m venv $venvDir
}

Write-Host 'Installing Python dependencies...'
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r (Join-Path $desktopRoot 'requirements.txt')

Write-Host 'Building Windows executable with PyInstaller...'
Push-Location $desktopRoot
try {
    $distDir = Join-Path $desktopRoot 'dist\ReadHelperDesktop'
    if (Test-Path $distDir) {
        try {
            Remove-Item -Recurse -Force $distDir
        } catch {
            Write-Warning 'Could not remove existing dist\ReadHelperDesktop. Close the running app/explorer and retry.'
        }
    }

    & $pythonExe -m PyInstaller --noconfirm --clean --windowed --name ReadHelperDesktop --add-data "frontend;frontend" app.py
    if ($LASTEXITCODE -ne 0) {
        throw 'PyInstaller build failed.'
    }
} finally {
    Pop-Location
}

$runtimeGroqConfig = Join-Path $desktopRoot 'groq.config.json'
$distGroqConfig = Join-Path $distDir 'groq.config.json'

if (Test-Path $runtimeGroqConfig) {
    Copy-Item -Force $runtimeGroqConfig $distGroqConfig
    Write-Host 'Copied groq.config.json to dist\ReadHelperDesktop\groq.config.json'
} else {
    Write-Warning 'groq.config.json not found. Desktop AI requires a user-provided key in AI settings.'
}

Write-Host 'EXE build complete: dist\ReadHelperDesktop\ReadHelperDesktop.exe'
