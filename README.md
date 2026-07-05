# YouTube Downloader

Personal-use desktop downloader (Electron + React + TypeScript) for content you
have the right to save. yt-dlp and FFmpeg are bundled — end users need no
Python, Node, or developer tools.

## Develop

```sh
npm install
npm run dev          # hot-reloading dev app
```

## Test

```sh
node test/engine.test.mjs   # downloader engine, real yt-dlp runs
npm run build && node test/ui.test.mjs   # end-to-end through the real UI
```

## Package

```sh
npm run dist:mac     # dist/YouTube Downloader <ver>.dmg (+ .app in dist/mac-arm64)
npm run dist:win     # dist/YouTube Downloader Setup <ver>.exe + portable .exe
```

Bundled binaries live in `resources/bin/` (yt-dlp 2026.07.04, FFmpeg 6.0),
pinned by download in-place. "Update Downloader" in Settings fetches the latest
yt-dlp into user data; the bundled copy is never modified.
