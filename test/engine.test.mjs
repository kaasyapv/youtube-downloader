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

// --- cancel mid-download
{
  events = []
  const job = yt.createJob(video, 'mp4', '1080', tmp, none)
  const running = yt.runJob(paths, job, (p) => events.push(p))
  await new Promise((r) => setTimeout(r, 6000))
  yt.cancel()
  const res = await running
  assert.equal(res.status, 'cancelled')
  console.log('OK cancel: job reported cancelled')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('\nALL ENGINE CHECKS PASSED')
