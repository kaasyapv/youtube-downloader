// Engine self-check with real yt-dlp runs. Usage: node test/engine.test.mjs
// Downloads small CC-licensed Blender content into a temp dir, then cleans up.
import { execSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const bundle = path.join(os.tmpdir(), 'ytdlp-engine-test.cjs')
execSync(
  `npx esbuild src/main/ytdlp.ts --bundle --platform=node --format=cjs --outfile=${bundle}`,
  { cwd: root, stdio: 'inherit' }
)
const yt = await import(bundle)

const paths = {
  ytdlp: path.join(root, 'resources/bin/darwin-arm64/yt-dlp_macos'),
  ffmpegDir: path.join(root, 'resources/bin/darwin-arm64')
}
const none = { mode: 'none' }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-test-'))
const BBB = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' // Big Buck Bunny, CC-BY
const PLAYLIST = 'https://www.youtube.com/playlist?list=PLpp5nYHZleJq2j-KcazFdrYafb9agDAWP'

// --- unit: url validation + name sanitizing
assert.ok(yt.validYoutubeUrl(BBB))
assert.ok(yt.validYoutubeUrl('https://youtu.be/aqz-KE-bpKQ'))
assert.ok(yt.validYoutubeUrl('https://www.youtube.com/shorts/MuzvDonoNRo'))
assert.ok(!yt.validYoutubeUrl('https://evil.example.com/watch?v=x'))
assert.ok(!yt.validYoutubeUrl('file:///etc/passwd'))
assert.ok(!yt.validYoutubeUrl('not a url'))
assert.equal(yt.sanitizeName('a/b\\c:d*e?"f"<g>|h'), 'abcdefgh')
assert.equal(yt.sanitizeName('  My  Playlist  '), 'My Playlist')
console.log('OK unit: validation + sanitize')

// --- info: single video
const video = await yt.fetchInfo(paths, BBB, none)
assert.equal(video.kind, 'video')
assert.ok(video.title.includes('Big Buck Bunny'))
assert.ok(video.thumbnail.startsWith('https://'))
assert.ok(video.duration > 600)
assert.equal(video.uploader, 'Blender')
console.log('OK info: video', JSON.stringify(video.title))

// --- info: playlist with exact-ID verification
const pl = await yt.fetchInfo(paths, PLAYLIST, none)
assert.equal(pl.kind, 'playlist')
assert.equal(pl.id, 'PLpp5nYHZleJq2j-KcazFdrYafb9agDAWP') // exact ID preserved
assert.ok(pl.count >= 10)
assert.ok(pl.entries.every((e) => e.id && e.url))
assert.ok(pl.owner !== '')
console.log(`OK info: playlist "${pl.title}" by ${pl.uploader}, ${pl.count} videos, id verified`)

// --- download: single mp4 at 360p with real progress events
let events = []
{
  const job = yt.createJob(video, 'mp4', '360', tmp, none)
  const res = await yt.runJob(paths, job, (p) => events.push(p))
  assert.equal(res.status, 'done')
  const f = fs.readdirSync(tmp).find((n) => n.endsWith('.mp4'))
  assert.ok(f, 'mp4 exists')
  assert.ok(fs.statSync(path.join(tmp, f)).size > 10e6, 'mp4 is > 10MB')
  const dl = events.filter((e) => e.stage === 'downloading' && e.percent > 0 && e.percent < 100)
  assert.ok(dl.length > 3, 'saw real intermediate progress events')
  assert.ok(dl.some((e) => e.speed > 0), 'saw real speed')
  assert.ok(dl.some((e) => e.eta != null), 'saw real ETA')
  console.log(`OK download: mp4 (${dl.length} intermediate progress events, ` +
    `peak ${(Math.max(...dl.map((e) => e.speed)) / 1e6).toFixed(1)} MB/s)`)
}

// --- playlist job: 2 real entries + 1 bogus -> partial, zip successes, retry runs
{
  const meta = {
    ...pl,
    count: 3,
    entries: [
      ...pl.entries.slice(0, 2),
      { id: 'aaaaaaaaaaa', title: 'bogus entry', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }
    ]
  }
  events = []
  const job = yt.createJob(meta, 'mp3', 'highest', tmp, none)
  const res = await yt.runJob(paths, job, (p) => events.push(p))
  assert.equal(res.status, 'partial', 'bogus entry must cause partial status')
  const failed = res.results.filter((r) => !r.ok)
  assert.equal(failed.length, 1)
  assert.equal(failed[0].id, 'aaaaaaaaaaa')
  assert.ok(failed[0].error.length > 0, 'failure has a reported reason')
  assert.ok(events.some((e) => e.itemIndex === 2 && e.itemCount === 3), 'overall counter emitted')
  console.log(`OK playlist: partial (failed: "${failed[0].error.slice(0, 60)}")`)

  // retry the failed item -> still fails, loop executes without throwing
  const retry = await yt.runJob(paths, job, () => {}, ['aaaaaaaaaaa'])
  assert.equal(retry.status, 'partial')
  console.log('OK retry: re-ran failed item')

  // zip only the successes
  const zipPath = await yt.zipStaging(job, () => {})
  assert.ok(fs.existsSync(zipPath))
  assert.ok(fs.statSync(zipPath).size > 1e6, 'zip has real content')
  assert.ok(!fs.existsSync(job.stagingDir), 'staging cleaned up')
  const listing = execSync(`unzip -l "${zipPath}"`).toString()
  assert.equal((listing.match(/\.mp3/g) ?? []).length, 2, 'zip has exactly the 2 successes')
  console.log('OK zip: partial zip contains 2 mp3s ->', path.basename(zipPath))
}

// --- unavailable playlist items: real playlist containing deleted/private videos
{
  const DEAD = 'https://www.youtube.com/playlist?list=PL63F0C78739B09958'
  const dead = await yt.fetchInfo(paths, DEAD, none)
  assert.ok(dead.unavailable.length >= 2, `found unavailable items (got ${dead.unavailable.length})`)
  assert.ok(dead.unavailable.every((u) => u.reason.length > 0), 'each has a reason')
  assert.equal(dead.count, dead.entries.length, 'count excludes unavailable items')
  assert.ok(dead.entries.every((e) => e.title && !/^\[(Private|Deleted|Unavailable|Hidden)/i.test(e.title)),
    'download queue has no dead entries')
  assert.ok(dead.totalDuration > 1000, 'totalDuration summed for size estimate')
  console.log(`OK unavailable: ${dead.unavailable.length} dead items excluded ` +
    `(${dead.unavailable.map((u) => u.reason).join(', ')}), ${dead.count} downloadable`)
}

// --- transient-error classifier
assert.ok(yt.isTransient('unable to download video data: HTTP Error 503: Service Unavailable'))
assert.ok(yt.isTransient('Connection reset by peer'))
assert.ok(yt.isTransient('The read operation timed out'))
assert.ok(!yt.isTransient('Private video. Sign in if you have been granted access'))
assert.ok(!yt.isTransient('Video unavailable. This video has been removed by the uploader'))
assert.ok(!yt.isTransient('cancelled'))
assert.ok(!yt.isTransient(undefined))
console.log('OK classifier: transient vs permanent')

// --- auto-retry: wrapper injects one transient HTTP failure, then real yt-dlp succeeds
const SHORT = 'https://www.youtube.com/shorts/MuzvDonoNRo'
const short = await yt.fetchInfo(paths, SHORT, none)
{
  const flag = path.join(tmp, 'failed-once')
  const fake = path.join(tmp, 'fake-ytdlp')
  fs.writeFileSync(fake, `#!/bin/sh
if [ ! -f "${flag}" ]; then
  touch "${flag}"
  echo "ERROR: unable to download video data: HTTP Error 503: Service Unavailable" >&2
  exit 1
fi
exec "${paths.ytdlp}" "$@"
`)
  fs.chmodSync(fake, 0o755)
  events = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-retry-'))
  const job = yt.createJob(short, 'mp3', 'highest', dir, none)
  const res = await yt.runJob({ ...paths, ytdlp: fake }, job, (p) => events.push(p))
  assert.equal(res.status, 'done', 'recovered after transient failure')
  assert.ok(events.some((e) => e.stage === 'retrying' && e.attempt === 1), 'emitted Retrying (1/3)')
  const out = fs.readdirSync(dir)
  assert.ok(out.some((f) => f.endsWith('.mp3')), 'file downloaded on retry')
  assert.ok(out.every((f) => !/\.(part|partial|ytdl|temp|download)/i.test(f)), 'no temp names left')
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('OK retry: transient failure auto-retried and succeeded')
}

// --- retry cap: always-failing item stops after 3 retries, playlist continues
{
  const cnt = path.join(tmp, 'attempts')
  const fake = path.join(tmp, 'fake-ytdlp-cap')
  // fails transiently ONLY for the Big Buck Bunny id; other items pass through
  fs.writeFileSync(fake, `#!/bin/sh
case "$*" in *aqz-KE-bpKQ*)
  echo x >> "${cnt}"
  echo "ERROR: unable to download video data: HTTP Error 503: Service Unavailable" >&2
  exit 1;;
esac
exec "${paths.ytdlp}" "$@"
`)
  fs.chmodSync(fake, 0o755)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-cap-'))
  const meta = {
    ...short, kind: 'playlist', title: 'RetryCap', count: 2,
    entries: [
      { id: 'aqz-KE-bpKQ', title: 'always 503', url: BBB },
      short.entries[0]
    ]
  }
  events = []
  const t0 = Date.now()
  const job = yt.createJob(meta, 'mp3', 'highest', dir, none)
  const res = await yt.runJob({ ...paths, ytdlp: fake }, job, (p) => events.push(p))
  const attempts = fs.readFileSync(cnt, 'utf8').trim().split('\n').length
  assert.equal(attempts, 4, '1 attempt + exactly 3 retries, no infinite loop')
  assert.ok(Date.now() - t0 >= 1500 + 3000 + 6000, 'exponential backoff waits happened')
  assert.equal(res.status, 'partial', 'playlist continued after retries exhausted')
  assert.equal(res.results.filter((r) => r.ok).length, 1, 'remaining item downloaded')
  assert.deepEqual(
    events.filter((e) => e.stage === 'retrying').map((e) => e.attempt), [1, 2, 3])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`OK retry cap: 4 attempts, backoff respected, playlist continued`)
}

// --- launch cleanup removes OLD temp leftovers, keeps real files and fresh staging
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-clean-'))
  const old = (Date.now() - 25 * 3600 * 1000) / 1000
  for (const f of ['a.mp4.part', 'b.part-Frag3', 'c.ytdl', 'd.temp', 'e.download']) {
    const p = path.join(dir, f)
    fs.writeFileSync(p, 'x')
    fs.utimesSync(p, old, old) // abandoned yesterday
  }
  fs.mkdirSync(path.join(dir, '.Old Playlist.partial'))
  fs.writeFileSync(path.join(dir, '.Old Playlist.partial', 'file.mp4'), 'x')
  fs.utimesSync(path.join(dir, '.Old Playlist.partial'), old, old)
  fs.writeFileSync(path.join(dir, 'keep.mp4'), 'x')
  fs.writeFileSync(path.join(dir, 'my.partial.notes.txt'), 'x') // not a temp suffix
  // fresh staging from a session that was force-quit minutes ago: must survive
  fs.mkdirSync(path.join(dir, '.Fresh Playlist.partial'))
  fs.writeFileSync(path.join(dir, '.Fresh Playlist.partial', 'kept.mp4'), 'x')
  fs.writeFileSync(path.join(dir, 'fresh.mp4.part'), 'x')
  await yt.cleanupTemps(dir)
  assert.deepEqual(fs.readdirSync(dir).sort(),
    ['.Fresh Playlist.partial', 'fresh.mp4.part', 'keep.mp4', 'my.partial.notes.txt'])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('OK cleanup: old temp leftovers removed, fresh staging and real files kept')
}

// --- zip never includes temp files
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-zip-'))
  const meta = { ...short, kind: 'playlist', title: 'ZipHygiene', count: 1 }
  const job = yt.createJob(meta, 'mp3', 'highest', dir, none)
  fs.mkdirSync(job.stagingDir, { recursive: true })
  fs.writeFileSync(path.join(job.stagingDir, '001 - done.mp3'), 'real content here')
  for (const f of ['002 - inflight.mp3.part', '003.part-Frag9', '004.ytdl', '005.temp']) {
    fs.writeFileSync(path.join(job.stagingDir, f), 'x')
  }
  const zipPath = await yt.zipStaging(job, () => {})
  const listing = execSync(`unzip -v "${zipPath}"`).toString()
  assert.ok(listing.includes('001 - done.mp3'))
  for (const bad of ['.part', '.ytdl', '.temp']) assert.ok(!listing.includes(bad), `zip has no ${bad}`)
  assert.ok(listing.includes('Stored'), 'entries stored, not deflated (big-playlist zip stall fix)')
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('OK zip hygiene: only completed files zipped, store mode')
}

// --- cancel mid-download
{
  events = []
  // fresh dir: reusing tmp would collide with the finished 360p file and let
  // yt-dlp short-circuit with "already downloaded" before cancel can land
  const cancelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-cancel-'))
  const job = yt.createJob(video, 'mp4', '360', cancelDir, none)
  const running = yt.runJob(paths, job, (p) => events.push(p))
  // cancel as soon as real bytes are flowing — a fixed sleep races fast connections;
  // racing against `running` keeps this from hanging if the download errors instantly
  let timer
  await Promise.race([
    running,
    new Promise((r) => {
      timer = setInterval(() => {
        if (events.some((e) => e.stage === 'downloading' && e.percent > 0)) r()
      }, 100)
    })
  ])
  clearInterval(timer)
  yt.cancel()
  const res = await running
  assert.equal(res.status, 'cancelled')
  fs.rmSync(cancelDir, { recursive: true, force: true })
  console.log("OK cancel: job reported cancelled")
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('\nALL ENGINE CHECKS PASSED')
