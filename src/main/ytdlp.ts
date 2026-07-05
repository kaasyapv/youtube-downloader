// Downloader engine. Pure Node (no Electron imports) so it can be tested directly.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// @ts-ignore -- yazl ships its own loose types
import yazl from 'yazl'

export interface Paths {
  ytdlp: string
  ffmpegDir: string
}

export interface Cookies {
  mode: 'none' | 'chrome' | 'safari' | 'firefox' | 'edge' | 'brave' | 'file'
  file?: string
}

export interface Entry {
  id: string
  title: string
  url: string
}

export interface Meta {
  kind: 'video' | 'playlist'
  id: string
  url: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  count: number
  entries: Entry[]
  /** playlist items yt-dlp reports as private/deleted/hidden — never downloaded */
  unavailable: { id: string; reason: string }[]
  /** summed duration of downloadable entries, for size estimation */
  totalDuration: number
}

export interface Progress {
  stage: 'starting' | 'downloading' | 'converting' | 'zipping' | 'retrying'
  itemIndex: number
  itemCount: number
  itemTitle: string
  percent: number
  speed: number | null
  eta: number | null
  overallPercent: number
  downloadedBytes?: number
  attempt?: number
}

export interface ItemResult {
  id: string
  title: string
  ok: boolean
  error?: string
}

export interface JobResult {
  status: 'done' | 'partial' | 'cancelled' | 'error'
  results: ItemResult[]
  outputPath: string
  error?: string
}

const HOSTS = new Set([
  'www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'
])

export function validYoutubeUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && HOSTS.has(u.hostname)
}

function cookieArgs(c: Cookies): string[] {
  if (c.mode === 'none') return []
  if (c.mode === 'file') return c.file ? ['--cookies', c.file] : []
  return ['--cookies-from-browser', c.mode]
}

// ---------------------------------------------------------------- process management

let cancelled = false
const active = new Set<ChildProcess>()

export function cancel(): void {
  cancelled = true
  for (const p of active) p.kill('SIGKILL')
}

function run(
  paths: Paths,
  args: string[],
  onLine?: (line: string) => void
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(paths.ytdlp, args, { windowsHide: true })
    active.add(p)
    let stdout = ''
    let stderr = ''
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      stdout += d
      if (!onLine) return
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      lines.forEach(onLine)
    })
    p.stderr.on('data', (d: Buffer) => (stderr += d))
    p.on('error', (e) => {
      active.delete(p)
      reject(e)
    })
    p.on('close', (code) => {
      active.delete(p)
      resolve({ code, stdout, stderr })
    })
  })
}

function cleanError(stderr: string, fallback: string): string {
  const line = stderr.split('\n').find((l) => l.startsWith('ERROR:'))
  return (line ?? fallback).replace(/^ERROR:\s*/, '').slice(0, 300)
}

// ---------------------------------------------------------------- metadata

export async function fetchInfo(paths: Paths, url: string, cookies: Cookies): Promise<Meta> {
  if (!validYoutubeUrl(url)) throw new Error('Not a YouTube URL')
  const args = ['-J', '--flat-playlist', '--no-warnings', ...cookieArgs(cookies), '--', url]
  const { code, stdout, stderr } = await run(paths, args)
  if (code !== 0) throw new Error(cleanError(stderr, 'Could not fetch video info'))
  const info = JSON.parse(stdout)

  if (info._type === 'playlist') {
    // The pasted URL's playlist ID is authoritative. If the resolver returned a
    // different playlist (Mix substitution, redirects, anything), refuse loudly.
    const requested = new URL(url).searchParams.get('list')
    if (requested && info.id !== requested) {
      throw new Error(
        `Playlist mismatch: your URL is for playlist "${requested}" but YouTube returned ` +
          `"${info.id}". Refusing to download the wrong playlist.`
      )
    }
    // Flat entries for dead videos have a null title (or a "[Private video]"-style
    // placeholder). They are surfaced separately and never enter the download queue.
    const reasonOf = (title: unknown): string | null => {
      if (title == null) return 'Unavailable'
      const m = /^\[(Private|Deleted|Unavailable|Hidden)/i.exec(String(title))
      return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null
    }
    const entries: Entry[] = []
    const unavailable: Meta['unavailable'] = []
    let totalDuration = 0
    for (const e of (info.entries ?? []).filter((x: unknown): x is Record<string, any> => !!x)) {
      const reason = reasonOf(e.title)
      if (reason) {
        unavailable.push({ id: String(e.id ?? ''), reason })
      } else {
        entries.push({
          id: e.id,
          title: e.title ?? e.id,
          url: e.url ?? `https://www.youtube.com/watch?v=${e.id}`
        })
        totalDuration += Number(e.duration ?? 0)
      }
    }
    if (entries.length === 0) throw new Error('Playlist is empty or its videos are hidden')
    return {
      kind: 'playlist',
      id: info.id,
      url,
      title: info.title ?? 'Playlist',
      uploader: info.uploader ?? info.channel ?? 'Unknown',
      duration: 0,
      thumbnail:
        info.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${entries[0].id}/hqdefault.jpg`,
      count: entries.length,
      entries,
      unavailable,
      totalDuration
    }
  }

  return {
    kind: 'video',
    id: info.id,
    url,
    title: info.title ?? '',
    uploader: info.uploader ?? info.channel ?? 'Unknown',
    duration: info.duration ?? 0,
    thumbnail: info.thumbnail ?? '',
    count: 1,
    entries: [{ id: info.id, title: info.title ?? info.id, url }],
    unavailable: [],
    totalDuration: info.duration ?? 0
  }
}

// ---------------------------------------------------------------- downloading

function formatArgs(format: 'mp4' | 'mp3', quality: string): string[] {
  if (format === 'mp3') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
  const f =
    quality === 'highest'
      ? 'bv*+ba/b'
      : `bv*[height<=?${quality}]+ba/b[height<=?${quality}]/b`
  return ['-f', f, '--merge-output-format', 'mp4']
}

// "download:" selects the event type; the template itself must emit its own marker
const TPL =
  'download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'

const num = (s: string): number | null => (s === 'NA' || s === '' ? null : Number(s))

async function downloadOne(
  paths: Paths,
  url: string,
  outTemplate: string,
  format: 'mp4' | 'mp3',
  quality: string,
  cookies: Cookies,
  onProgress: (p: {
    stage: 'downloading' | 'converting'
    percent: number
    speed: number | null
    eta: number | null
    downloadedBytes?: number
  }) => void
): Promise<{ ok: boolean; error?: string }> {
  const args = [
    ...formatArgs(format, quality),
    '--ffmpeg-location', paths.ffmpegDir,
    '--no-playlist',
    '-N', '4',
    '--newline',
    '--no-warnings',
    '--progress-template', TPL,
    '-o', outTemplate,
    ...cookieArgs(cookies),
    '--', url
  ]
  // Smoothed ETA: exponential moving average of speed, ETA surfaced only when it
  // moves by >= 2s so it doesn't flap. Events are coalesced to at most 4/s.
  let ema = 0
  let lastEmit = 0
  let lastEta: number | null = null
  const { code, stderr } = await run(paths, args, (line) => {
    if (line.startsWith('PROG|')) {
      const [status, downloaded, total, estimate, speed, eta] = line.slice(5).split('|')
      if (status !== 'downloading') return
      const rawSpeed = num(speed)
      if (rawSpeed) ema = ema ? 0.25 * rawSpeed + 0.75 * ema : rawSpeed
      const t = num(total) ?? num(estimate)
      const d = num(downloaded) ?? 0
      const percent = t ? Math.min(100, Math.round((100 * d) / t)) : 0
      const now = Date.now()
      if (now - lastEmit < 250 && percent < 100) return
      lastEmit = now
      let etaS = t && ema ? (t - d) / ema : num(eta)
      if (etaS != null && lastEta != null && Math.abs(etaS - lastEta) < 2) etaS = lastEta
      else lastEta = etaS
      onProgress({
        stage: 'downloading',
        percent,
        speed: ema || rawSpeed,
        eta: etaS == null ? null : Math.round(etaS),
        downloadedBytes: d
      })
    } else if (/^\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) {
      onProgress({ stage: 'converting', percent: 100, speed: null, eta: null })
    }
  })
  if (cancelled) return { ok: false, error: 'cancelled' }
  if (code !== 0) {
    let msg = cleanError(stderr, 'Download failed')
    if (/no space left/i.test(stderr)) msg = 'Not enough disk space'
    return { ok: false, error: msg }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- transient failures

// Permanent wins over transient: "Video unavailable ... HTTP Error 410" must not retry.
const PERMANENT =
  /Private video|Video unavailable|no longer available|has been removed|copyright|terminated|members.only|Sign in|age.restricted|Incomplete YouTube ID|not a valid URL|Unsupported URL/i
const TRANSIENT =
  /HTTP Error|Connection re(set|fused)|ECONN|ETIMEDOUT|timed? ?out|Temporary failure|IncompleteRead|ContentTooShort|EOF occurred|network|getaddrinfo|SSL|unable to download/i

export function isTransient(err?: string): boolean {
  return !!err && !PERMANENT.test(err) && TRANSIENT.test(err)
}

// ---------------------------------------------------------------- temp-file hygiene

// yt-dlp in-flight names (.part, .part-Frag3, .ytdl) plus other temp suffixes
const TEMP_FILE = /\.(part(-Frag\d+)?|ytdl|ytdl-temp|download|temp)$/i
const STAGING_DIR = /^\..+\.partial$/

/** Remove leftovers from interrupted downloads (top level of the download dir only). */
export async function cleanupTemps(dir: string): Promise<void> {
  let items
  try {
    items = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const it of items) {
    if (it.isDirectory() ? STAGING_DIR.test(it.name) : TEMP_FILE.test(it.name)) {
      await fsp.rm(path.join(dir, it.name), { recursive: true, force: true }).catch(() => {})
    }
  }
}

// ---------------------------------------------------------------- job orchestration

export function sanitizeName(t: string): string {
  return t.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim() || 'download'
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p
  const ext = path.extname(p)
  const base = p.slice(0, -ext.length || undefined)
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!fs.existsSync(candidate)) return candidate
  }
}

async function assertDiskSpace(dir: string): Promise<void> {
  // ponytail: 200MB floor, not a size prediction — ENOSPC during download is also handled
  const st = await fsp.statfs(dir)
  if (st.bavail * st.bsize < 200 * 1024 * 1024) {
    throw new Error('Less than 200 MB free in the download folder')
  }
}

export interface Job {
  meta: Meta
  format: 'mp4' | 'mp3'
  quality: string
  dir: string
  cookies: Cookies
  stagingDir: string
  results: Map<string, ItemResult>
}

export function createJob(
  meta: Meta,
  format: 'mp4' | 'mp3',
  quality: string,
  dir: string,
  cookies: Cookies
): Job {
  const stagingDir =
    meta.kind === 'playlist' ? path.join(dir, `.${sanitizeName(meta.title)}.partial`) : dir
  return { meta, format, quality, dir, cookies, stagingDir, results: new Map() }
}

/** Download all entries (or only `onlyIds` for retries). Zips automatically when
 *  every playlist item has succeeded. */
export async function runJob(
  paths: Paths,
  job: Job,
  emit: (p: Progress) => void,
  onlyIds?: string[]
): Promise<JobResult> {
  cancelled = false
  const { meta } = job
  try {
    await assertDiskSpace(job.dir)
  } catch (e) {
    return { status: 'error', results: [], outputPath: '', error: (e as Error).message }
  }

  const targets = onlyIds
    ? meta.entries.filter((e) => onlyIds.includes(e.id))
    : meta.entries

  if (meta.kind === 'playlist') {
    await fsp.mkdir(job.stagingDir, { recursive: true })
    // dot-prefix does not hide folders on Windows — set the hidden attribute so
    // in-flight staging never looks like a finished download
    if (process.platform === 'win32') spawn('attrib', ['+h', job.stagingDir], { windowsHide: true })
  }

  for (const entry of targets) {
    if (cancelled) break
    const idx = meta.entries.indexOf(entry)
    const doneCount = [...job.results.values()].filter((r) => r.ok).length
    const template =
      meta.kind === 'playlist'
        ? path.join(
            job.stagingDir,
            `${String(idx + 1).padStart(3, '0')} - %(title).100B [%(id)s].%(ext)s`
          )
        : path.join(job.dir, '%(title).120B [%(id)s].%(ext)s')
    emit({
      stage: 'starting', itemIndex: idx + 1, itemCount: meta.count, itemTitle: entry.title,
      percent: 0, speed: null, eta: null,
      overallPercent: Math.round((100 * doneCount) / meta.count)
    })
    const dl = (): ReturnType<typeof downloadOne> =>
      downloadOne(
        paths, entry.url, template, job.format, job.quality, job.cookies,
        (p) =>
          emit({
            ...p,
            itemIndex: idx + 1,
            itemCount: meta.count,
            itemTitle: entry.title,
            overallPercent: Math.round((100 * (doneCount + p.percent / 100)) / meta.count)
          })
      )
    let res = await dl()
    // auto-retry transient network failures with backoff; hard cap of 3 retries
    for (let attempt = 1; attempt <= 3 && !cancelled && !res.ok && isTransient(res.error); attempt++) {
      emit({
        stage: 'retrying', attempt, itemIndex: idx + 1, itemCount: meta.count,
        itemTitle: entry.title, percent: 0, speed: null, eta: null,
        overallPercent: Math.round((100 * doneCount) / meta.count)
      })
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)))
      if (cancelled) break
      res = await dl()
    }
    job.results.set(entry.id, { id: entry.id, title: entry.title, ok: res.ok, error: res.error })
  }

  if (cancelled) {
    if (meta.kind === 'playlist') await fsp.rm(job.stagingDir, { recursive: true, force: true })
    return { status: 'cancelled', results: [...job.results.values()], outputPath: '' }
  }

  const results = [...job.results.values()]
  const failed = results.filter((r) => !r.ok)
  if (meta.kind === 'video') {
    return failed.length
      ? { status: 'error', results, outputPath: '', error: failed[0].error }
      : { status: 'done', results, outputPath: job.dir }
  }
  if (failed.length > 0) return { status: 'partial', results, outputPath: '' }

  // ZIP only once every item has succeeded (or user explicitly zips a partial set)
  const zipPath = await zipStaging(job, emit)
  return { status: 'done', results, outputPath: zipPath }
}

/** Zip whatever finished successfully in the staging dir, then remove it. */
export async function zipStaging(job: Job, emit: (p: Progress) => void): Promise<string> {
  emit({
    stage: 'zipping', itemIndex: job.meta.count, itemCount: job.meta.count,
    itemTitle: '', percent: 100, speed: null, eta: null, overallPercent: 100
  })
  // only completed files: yt-dlp temp names must never reach the ZIP
  const files = (await fsp.readdir(job.stagingDir)).filter((f) => !TEMP_FILE.test(f)).sort()
  if (files.length === 0) throw new Error('Nothing downloaded successfully — nothing to zip')
  const zipPath = uniquePath(path.join(job.dir, `${sanitizeName(job.meta.title)}.zip`))
  const zip = new yazl.ZipFile()
  for (const f of files) zip.addFile(path.join(job.stagingDir, f), f)
  zip.end()
  await pipeline(zip.outputStream, fs.createWriteStream(zipPath))
  await fsp.rm(job.stagingDir, { recursive: true, force: true })
  return zipPath
}

// ---------------------------------------------------------------- yt-dlp self-update

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
export const YTDLP_EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_macos'

/** Download the latest yt-dlp (onedir build — fast startup) into destDir/ytdlp
 *  and return its version. Never automatic. */
export async function updateYtdlp(destDir: string, ffmpegDir: string): Promise<string> {
  const asset = process.platform === 'win32' ? 'yt-dlp_win.zip' : 'yt-dlp_macos.zip'
  await fsp.mkdir(destDir, { recursive: true })
  const zipPath = path.join(destDir, asset)
  const res = await fetch(RELEASE + asset)
  if (!res.ok || !res.body) throw new Error(`Update download failed (HTTP ${res.status})`)
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(zipPath))
  // bsdtar ships with both macOS and Windows 10+ and extracts zips
  const extractDir = path.join(destDir, 'ytdlp-new')
  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const p = spawn('tar', ['-xf', zipPath, '-C', extractDir], { windowsHide: true })
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('Could not unpack update'))))
    p.on('error', reject)
  })
  await fsp.rm(zipPath, { force: true })
  const exe = path.join(extractDir, YTDLP_EXE)
  if (process.platform !== 'win32') await fsp.chmod(exe, 0o755)
  const { code, stdout, stderr } = await run({ ytdlp: exe, ffmpegDir }, ['--version'])
  if (code !== 0) throw new Error(cleanError(stderr, 'Updated binary failed to run'))
  const finalDir = path.join(destDir, 'ytdlp')
  await fsp.rm(finalDir, { recursive: true, force: true })
  await fsp.rename(extractDir, finalDir)
  return stdout.trim()
}

export function ytdlpVersion(paths: Paths): Promise<string> {
  return run(paths, ['--version']).then((r) => r.stdout.trim())
}
