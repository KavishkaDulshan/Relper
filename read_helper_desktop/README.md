# Relper Desktop (Python)

This is a standalone Windows desktop packaging project for the existing `read_helper` web app.

## What Was Ported

The desktop app preserves the current web functionality by embedding the built React app in a native window:

- Local PDF loading and rendering (`pdfjs-dist` behavior stays unchanged)
- Word selection dictionary lookup (`dictionaryapi.dev`)
- Phrase selection AI explanation (`text.pollinations.ai` fallback chain)
- Existing drag/resize popup and responsive UI logic

## Architecture

- `app.py`: launches a local Flask server for bundled static files and opens a native window via `pywebview`.
- `frontend/`: contains built files copied from `read_helper/dist`.
- `build_tools/sync_frontend.ps1`: builds the web app and syncs output to `frontend/`.
- `build_tools/build_exe.ps1`: builds Windows executable with PyInstaller.
- `build_tools/build_installer.ps1`: builds Windows installer with Inno Setup.

## Prerequisites (Windows)

1. Python 3.11+ installed and available as `python`.
2. Node.js + npm installed.
3. Inno Setup 6 installed at:
   `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`

## Build Steps

From this folder (`read_helper_desktop`):

1. Build EXE only:
   ```powershell
   .\build_tools\build_exe.ps1
   ```

2. Build installer (`.exe` setup wizard):
   ```powershell
   .\build_tools\build_installer.ps1
   ```

## Output Paths

- App executable folder: `dist\ReadHelperDesktop\`
- Main executable: `dist\ReadHelperDesktop\ReadHelperDesktop.exe`
- Installer: `dist\installer\ReadHelperDesktop-Setup.exe`

## Website Download Asset (GitHub Releases)

The website download button should point to one release asset file, not a folder/repository download.

- Release asset name used by the website: `RelperDesktop-Windows.zip`
- Direct download URL pattern:
   `https://github.com/KavishkaDulshan/Relper/releases/latest/download/RelperDesktop-Windows.zip`

This repo includes GitHub Actions workflow `.github/workflows/release-desktop.yml` that:

1. Builds the desktop app with `build_tools/build_exe.ps1`
2. Zips only `dist\ReadHelperDesktop\*` as `dist\RelperDesktop-Windows.zip`
3. Uploads that zip to a GitHub Release

To publish a new downloadable desktop build:

1. Create and push a version tag (example):
    `git tag v1.2.0`
    `git push origin v1.2.0`
2. Wait for the workflow to finish.
3. The website button will download the new asset from `releases/latest/download/...` automatically.

## Notes

- Internet is required for dictionary and AI API lookups.
- PDFs are opened locally from user machine; no PDF upload to server is performed.
- To refresh desktop content after web changes, rerun `build_tools/sync_frontend.ps1`.
