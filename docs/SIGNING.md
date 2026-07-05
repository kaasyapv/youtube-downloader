# macOS Signing & Notarization

## Why the DMG said "damaged"

Verified cause (not a guess): the packaged app still carried the Electron
prebuilt's linker-generated **ad-hoc** signature (`Identifier=Electron`), which
electron-builder invalidated when it repacked `Contents/Resources`
(`codesign` verdict: *"code has no resources but signature indicates they must
be present"*). Gatekeeper reports a quarantined app with a broken signature as
**"damaged and can't be opened."** The old `identity: null` config skipped
re-signing; it is removed, but electron-builder still skips signing when no
identity exists, so downloaded builds remain Gatekeeper-blocked until real
credentials are configured (workaround for testers:
`xattr -dr com.apple.quarantine "/Applications/YouTube Downloader.app"`).
Proper distribution needs the steps below — there is no unsigned shortcut on
modern macOS.

## What you need from Apple

1. An **Apple Developer Program** membership (paid, USD 99/year) — a free
   Apple ID cannot produce Developer ID certificates.
2. A **Developer ID Application** certificate (Certificates → create →
   "Developer ID Application"), exported from Keychain as a `.p12` with a
   password.
3. An **app-specific password** for your Apple ID (appleid.apple.com →
   Sign-In and Security → App-Specific Passwords).
4. Your **Team ID** (developer.apple.com → Membership).

## GitHub Actions secrets

Add in repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the `.p12`: `base64 -i devid.p12 \| pbcopy` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character Team ID |

`.github/workflows/release.yml` already passes these through. Once the
secrets exist, the next tagged release is signed, notarized (electron-builder
runs notarytool automatically when `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/
`APPLE_TEAM_ID` are set), and stapled. No workflow edits needed.

## One-command local build (after credentials)

```sh
export CSC_LINK=/path/to/devid.p12 CSC_KEY_PASSWORD='p12 password'
export APPLE_ID='you@example.com' APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx' APPLE_TEAM_ID='TEAMID1234'
npm run dist:mac
```

Verify afterwards:

```sh
codesign -dv --verbose=2 "dist/mac-arm64/YouTube Downloader.app"   # Developer ID + hardened runtime
spctl --assess --type execute -vv "dist/mac-arm64/YouTube Downloader.app"  # "accepted ... Notarized Developer ID"
stapler validate "dist/YouTube-Downloader.dmg"
```

Hardened-runtime entitlements live in `build/entitlements.mac.plist`. The
first notarized build may flag unsigned Mach-O binaries inside
`Resources/bin/` (bundled yt-dlp/FFmpeg); if notarytool rejects them, add the
reported paths under `mac.binaries` in `electron-builder.yml` so
electron-builder signs them too.

## Auto-updates and the private repo

electron-updater reads release metadata (`latest*.yml`) from GitHub Releases.
While the repo is **private**, every installed copy needs a GitHub token to
see releases: put a PAT with `repo` scope in the app's `settings.json` as
`"githubToken": "..."`. Making the repository public removes that requirement
entirely — flip visibility and updates work for everyone with no token.
Unsigned macOS builds cannot self-install (Squirrel.Mac requires a valid
signature); until signing is configured the app falls back to downloading and
opening the DMG. Windows self-installs without any signing.
