# Read Helper Web + Desktop

Read Helper is a PDF reading assistant that runs from one shared React codebase.

## Core Features

- Open local PDF files directly on device.
- Select a word to get dictionary definitions from dictionaryapi.dev.
- Phrase AI explanation is available in Desktop and Android hosts.
- Web-only mode (including GitHub Pages) focuses on dictionary word lookup and does not run AI phrase analysis.
- Zoom controls, page navigation, keyboard shortcuts.
- Movable/resizable popup with pronunciation and copy/read-aloud actions.
- High-contrast mode.
- Per-PDF word notes (enabled in hosted app shells like Desktop and Android via Capacitor).

## Architecture

The product uses one frontend implementation and multiple thin native hosts:

- Web app: Vite + React in this folder (`read_helper`).
- Desktop app: Python (`read_helper_desktop`) hosts the built web bundle in pywebview.

This means product behavior is implemented once in React, while Desktop packages and runs it natively.

## Key Frontend Modules

- `src/App.jsx`: orchestrates app state, file loading, selection lookup flow, notes storage.
- `src/components/PdfViewer.jsx`: PDF.js rendering, text-layer selection, page observation.
- `src/components/DictionaryPopup.jsx`: popup UI, drag/resize, actions.
- `src/utils/selectionUtils.js`: robust word vs phrase selection detection.
- `src/utils/dictionaryApi.js`: dictionary response normalization.
- `src/utils/aiExplainApi.js`: AI explanation pipeline with retries and local fallback.

## GitHub Pages Hosting

This project can be hosted on GitHub Pages.

The published site now opens as a minimal landing page with links to the web reader, the source code, and the latest desktop release.

1. Build with relative asset paths:

```powershell
npm run build:gh-pages
```

2. Publish the generated `dist/` folder to GitHub Pages.

3. Keep `public/.nojekyll` in the project so static assets are served correctly.

Notes:

- Web-hosted mode keeps dictionary lookup and PDF reading features.
- AI phrase analysis is intentionally disabled in web mode, so no private AI key/backend is required for GitHub Pages hosting.

### Automated Deployment (Recommended)

This repository includes a GitHub Actions workflow at `.github/workflows/deploy-gh-pages.yml`.

1. Push to the `main` branch.
2. The workflow will create/update the `gh-pages` branch automatically.
3. In GitHub: **Settings > Pages**.
4. Set **Source** to **Deploy from a branch**.
5. Select branch `gh-pages` and folder `/ (root)`.

After that, each push to `main` will rebuild and deploy `dist/` automatically.

## Setup

1. Install Node.js 20+.
2. From this folder run:

```powershell
npm install
```

## Web Development

```powershell
npm run dev
```

## Desktop Build

Desktop packaging remains in `read_helper_desktop` and is unchanged.
