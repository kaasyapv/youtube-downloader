import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as yt from './ytdlp'

// ---------------------------------------------------------------- settings (plain JSON)

export interface Settings {
  dir: string
  format: 'mp4' | 'mp3'
  quality: string
  theme: 'dark' | 'light'
  cookieMode: yt.Cookies['mode']
  cookiesFile: string
  /** optional PAT for update checks against a private repo; set by hand in settings.json */
  githubToken?: string
}

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')
const defaults = (): Settings => ({
  dir: app.getPath('downloads'),
  format: 'mp4',
  quality: 'highest',
  theme: 'dark',
  cookieMode: 'none',
  cookiesFile: ''
})

function loadSettings(): Settings {
  let s: Settings
  try {
    s = { ...defaults(), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return defaults()
  }
  // saved folder may be gone (unplugged drive) — fall back rather than fail later
  if (!fs.existsSync(s.dir)) s.dir = defaults().dir
  return s
}

// ---------------------------------------------------------------- bundled binaries

function binPaths(): yt.Paths {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin', `${process.platform}-${process.arch}`)
  // a user-requested update lands in userData and takes precedence over the bundled copy
  const updated = path.join(app.getPath('userData'), 'bin', 'ytdlp', yt.YTDLP_EXE)
  return {
    ytdlp: fs.existsSync(updated) ? updated : path.join(bundled, yt.YTDLP_EXE),
    ffmpegDir: bundled
  }
}

// ---------------------------------------------------------------- download stats

interface Stats {
  date: string
  bytes: number
  files: number
}

const statsFile = (): string => path.join(app.getPath('userData'), 'stats.json')
const today = (): string => new Date().toISOString().slice(0, 10)

function loadStats(): Stats {
  try {
    const s = JSON.parse(fs.readFileSync(statsFile(), 'utf8')) as Stats
    if (s.date === today()) return s
  } catch {
    /* fresh day / first run */
  }
  return { date: today(), bytes: 0, files: 0 }
}

let stats = { ...loadStats(), _lastItemBytes: 0, _lastItemKey: '' }

function trackProgress(p: yt.Progress): void {
  if (p.downloadedBytes == null) return
  const key = `${p.itemIndex}`
  if (stats._lastItemKey !== key) {
    stats._lastItemKey = key
    stats._lastItemBytes = 0
  }
  const delta = p.downloadedBytes - stats._lastItemBytes
  if (delta > 0) stats.bytes += delta
  stats._lastItemBytes = p.downloadedBytes
}

function flushStats(results: yt.ItemResult[]): void {
  stats.files += results.filter((r) => r.ok).length
  const { date, bytes, files } = stats
  fs.writeFileSync(statsFile(), JSON.stringify({ date, bytes, files }))
}

// ---------------------------------------------------------------- update check

const REPO = 'kaasyapv/youtube-downloader'
const REPO_URL = REPO ? `https://github.com/${REPO}` : 'https://github.com'

interface UpdateInfo {
  version: string
  url: string
  assets: { name: string; url: string }[]
}

function newer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number)
  const b = current.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!REPO) return null
  const token = loadSettings().githubToken || process.env.GH_TOKEN || ''
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new Error(`Update check failed (HTTP ${res.status})`)
  const rel = (await res.json()) as {
    tag_name: string
    html_url: string
    assets: { name: string; url: string }[]
  }
  const current = process.env.UPDATE_TEST_CURRENT ?? app.getVersion()
  if (!newer(rel.tag_name, current)) return null
  return { version: rel.tag_name.replace(/^v/, ''), url: rel.html_url, assets: rel.assets }
}

/** Download the right installer asset and open it. NSIS one-click updates the
 *  Windows install in place; on macOS the DMG opens for a drag-over (unsigned
 *  apps cannot self-replace). */
async function installUpdate(info: UpdateInfo): Promise<void> {
  const want = process.platform === 'win32' ? /Setup.*\.exe$/i : /\.dmg$/i
  const asset = info.assets.find((a) => want.test(a.name))
  if (!asset) {
    await shell.openExternal(info.url)
    return
  }
  const token = loadSettings().githubToken || process.env.GH_TOKEN || ''
  const res = await fetch(asset.url, {
    headers: {
      accept: 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  if (!res.ok || !res.body) throw new Error(`Update download failed (HTTP ${res.status})`)
  const dest = path.join(app.getPath('temp'), asset.name)
  const { Readable } = await import('node:stream')
  const { pipeline } = await import('node:stream/promises')
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest))
  await shell.openPath(dest)
  if (process.platform === 'win32') app.quit()
}

// ---------------------------------------------------------------- window

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#0B0B0B',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------- ipc

const QUALITIES = new Set(['highest', '2160', '1440', '1080', '720', '480', '360'])
const COOKIE_MODES = new Set(['none', 'chrome', 'safari', 'firefox', 'edge', 'brave', 'file'])

let lastMeta: yt.Meta | null = null
let job: yt.Job | null = null

const emit = (p: yt.Progress): void => {
  trackProgress(p)
  win?.webContents.send('progress', p)
}

function cookiesFrom(s: { cookieMode: string; cookiesFile: string }): yt.Cookies {
  return { mode: s.cookieMode as yt.Cookies['mode'], file: s.cookiesFile }
}

ipcMain.handle('settings:get', () => loadSettings())
ipcMain.handle('settings:set', (_e, s: Settings) => {
  if (!QUALITIES.has(s.quality) || !['mp4', 'mp3'].includes(s.format) ||
      !COOKIE_MODES.has(s.cookieMode) || !['dark', 'light'].includes(s.theme)) {
    throw new Error('invalid settings')
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
})

ipcMain.handle('pick:folder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('pick:cookies', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'cookies.txt', extensions: ['txt'] }]
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('clipboard:read', () => clipboard.readText())

ipcMain.handle('info', async (_e, url: string, cookies: { cookieMode: string; cookiesFile: string }) => {
  lastMeta = await yt.fetchInfo(binPaths(), String(url), cookiesFrom(cookies))
  return lastMeta
})

ipcMain.handle('download:start', async (_e, opts: Settings) => {
  if (!lastMeta) throw new Error('No video loaded')
  if (!QUALITIES.has(opts.quality) || !['mp4', 'mp3'].includes(opts.format)) {
    throw new Error('invalid options')
  }
  if (!fs.existsSync(opts.dir) || !fs.statSync(opts.dir).isDirectory()) {
    throw new Error('Download folder does not exist')
  }
  job = yt.createJob(lastMeta, opts.format, opts.quality, opts.dir, cookiesFrom(opts))
  const result = await yt.runJob(binPaths(), job, emit)
  flushStats(result.results)
  return result
})

ipcMain.handle('download:cancel', () => yt.cancel())

ipcMain.handle('download:retry', async () => {
  if (!job) throw new Error('No download to retry')
  const failed = [...job.results.values()].filter((r) => !r.ok).map((r) => r.id)
  return yt.runJob(binPaths(), job, emit, failed)
})

ipcMain.handle('download:zip-partial', async () => {
  if (!job) throw new Error('No download to zip')
  return yt.zipStaging(job, emit)
})

ipcMain.handle('open:path', async (_e, p: string) => {
  const st = await fs.promises.stat(p).catch(() => null)
  if (!st) return
  if (st.isDirectory()) await shell.openPath(p)
  else shell.showItemInFolder(p)
})

ipcMain.handle('ytdlp:version', () => yt.ytdlpVersion(binPaths()))
ipcMain.handle('ytdlp:update', () =>
  yt.updateYtdlp(path.join(app.getPath('userData'), 'bin'), binPaths().ffmpegDir)
)
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:meta', () => ({ version: app.getVersion(), repoUrl: REPO_URL }))
ipcMain.handle('stats:get', () => {
  const { date, bytes, files } = stats
  return date === today() ? { bytes, files } : { bytes: 0, files: 0 }
})
ipcMain.handle('update:check', () => checkForUpdate())
ipcMain.handle('update:install', (_e, info: UpdateInfo) => installUpdate(info))
ipcMain.handle('open:external', (_e, url: string) => {
  if (url === REPO_URL) shell.openExternal(url)
})

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  createWindow()
  // sweep leftovers (.part/.ytdl files, stale staging dirs) from interrupted downloads
  yt.cleanupTemps(loadSettings().dir)
  // silent launch-time check; renderer shows "New version available" if one exists
  checkForUpdate()
    .then((info) => info && win?.webContents.send('update-available', info))
    .catch(() => {})
})
app.on('window-all-closed', () => {
  yt.cancel()
  app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
