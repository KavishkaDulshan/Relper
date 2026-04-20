Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
$webRoot = Join-Path $repoRoot 'read_helper'
$frontendTarget = Join-Path $desktopRoot 'frontend'

Write-Host 'Building web app from read_helper...'
Push-Location $webRoot
try {
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'npm ci failed, retrying with npm install...'
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install Node dependencies.'
        }
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Frontend build failed. Ensure Node modules are installed correctly.'
    }
} finally {
    Pop-Location
}

$builtIndex = Join-Path $webRoot 'dist\index.html'
if (-not (Test-Path $builtIndex)) {
    throw "Build output missing: $builtIndex"
}

Write-Host 'Copying built files into desktop frontend bundle...'
if (Test-Path $frontendTarget) {
    Remove-Item -Recurse -Force "$frontendTarget\*"
} else {
    New-Item -ItemType Directory -Path $frontendTarget | Out-Null
}

Copy-Item -Recurse -Force (Join-Path $webRoot 'dist\*') $frontendTarget
Write-Host 'Frontend sync complete.'
