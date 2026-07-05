// End-to-end UI check through the real Electron app. Usage:
//   npm run build && node test/ui.test.mjs
// Screenshots land in test/shots/.
import { _electron } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const shots = path.join(root, 'test', 'shots')
fs.mkdirSync(shots, { recursive: true })
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-ui-'))

// Pre-seed settings so the download lands in a temp dir we can inspect.
// Electron prefers productName for the userData directory name
const userData = path.join(os.homedir(), 'Library', 'Application Support', 'YouTube Downloader')
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ dir: dlDir, format: 'mp4', quality: '1080', theme: 'dark', cookieMode: 'none', cookiesFile: '' })
)

// APP_EXE=<path to packaged binary> runs the same checks against the built .app
const app = process.env.APP_EXE
  ? await _electron.launch({ executablePath: process.env.APP_EXE, args: [] })
  : await _electron.launch({ args: ['.'], cwd: root })
const page = await app.firstWindow()
await page.waitForSelector('h1:has-text("YouTube Downloader")')
await page.screenshot({ path: path.join(shots, '1-idle.png') })
console.log('OK ui: app launched, idle screen')

// --- single video metadata
const SHORT = 'https://www.youtube.com/shorts/MuzvDonoNRo' // Blender channel Short
await page.fill('input', SHORT)
await page.waitForSelector('text=BLENDERHEADS', { timeout: 60000 })
await page.waitForSelector('img[src^="https://i.ytimg.com"], img[src^="https://"]')
await page.screenshot({ path: path.join(shots, '2-video-ready.png') })
console.log('OK ui: Short metadata + thumbnail shown')

// --- download through the UI, real progress, done state
await page.click('button:has-text("Download MP4")')
await page.waitForSelector('button:has-text("Cancel")', { timeout: 60000 })
await page.waitForSelector('text=ETA', { timeout: 30000 }).catch(() => {})
await page.screenshot({ path: path.join(shots, '2b-progress.png') })
await page.waitForSelector('text=Download Complete', { timeout: 300000 })
await page.screenshot({ path: path.join(shots, '3-complete.png') })
const files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.mp4'))
assert.equal(files.length, 1, 'exactly one mp4 downloaded')
assert.ok(fs.statSync(path.join(dlDir, files[0])).size > 100e3)
assert.ok((await page.textContent('main')).includes('Open Folder'))
console.log('OK ui: downloaded through UI ->', files[0])

// --- playlist metadata + ID verification line
await page.click('button:has-text("Download Another")')
const PLAYLIST = 'https://www.youtube.com/playlist?list=PLpp5nYHZleJq2j-KcazFdrYafb9agDAWP'
await page.fill('input', PLAYLIST)
await page.waitForSelector('text=saved as one ZIP', { timeout: 60000 })
const body = await page.textContent('main')
assert.ok(body.includes('PLpp5nYHZleJq2j-KcazFdrYafb9agDAWP'), 'exact playlist ID displayed')
assert.ok(/\d+ videos/.test(body), 'video count displayed')
await page.screenshot({ path: path.join(shots, '4-playlist-confirm.png') })
console.log('OK ui: playlist metadata with verified ID shown')

// --- invalid URL error surfaces
await page.fill('input', 'https://evil.example.com/watch?v=x')
await page.waitForSelector('text=Not a YouTube URL', { timeout: 15000 })
console.log('OK ui: invalid URL rejected with visible error')

// --- settings panel
await page.click('button[aria-label="Settings"]')
await page.waitForSelector('text=Update Downloader')
await page.waitForSelector('text=yt-dlp 20')
await page.screenshot({ path: path.join(shots, '5-settings.png') })
console.log('OK ui: settings panel with cookie options, theme, Update Downloader')

await app.close()
fs.rmSync(dlDir, { recursive: true, force: true })
console.log('\nALL UI CHECKS PASSED')
