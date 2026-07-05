import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, HardDrive, Keyboard, Lightbulb, Sparkles } from 'lucide-react'
import { fmtSpeed } from './lib/utils'

const FACTS = [
  'The first computer bug was a literal moth, taped into the Harvard Mark II logbook in 1947.',
  'MP3 encoding throws away sounds your ear masks anyway — that’s how it shrinks audio ~10×.',
  'YouTube’s first video, "Me at the zoo", is 19 seconds long and was uploaded in April 2005.',
  'H.264 video compression can reach ~1000:1 by predicting frames from their neighbours.',
  'The ZIP format is from 1989 — older than the World Wide Web.',
  'Ethernet was sketched on a napkin at Xerox PARC in 1973.',
  'The first hard drive (IBM, 1956) stored 3.75 MB and weighed about a ton.',
  'FFmpeg, which converts your downloads, started as one developer’s project in 2000.',
  'A 4K frame holds ~8.3 million pixels — 27× more than the first YouTube videos.',
  'The progress bar was popularised by a 1985 paper showing people prefer any bar to none.',
  'TCP, carrying this download, was described by Cerf and Kahn in 1974.',
  'The first webcam watched a coffee pot at Cambridge so researchers avoided empty trips.',
  'Video is ~80% of all internet traffic — most of it compressed with codecs like VP9 and AV1.',
  'The floppy-disk save icon outlived the floppy disk by decades.',
  'Unicode has more than 149,000 characters — including the ▶ on this app’s logo.'
]

const TIPS = [
  'MP3 mode grabs the best audio stream only — much faster than downloading video.',
  'Failed playlist items can be retried without re-downloading the ones that worked.',
  'Pick a lower quality for old videos — many have no 4K source, so "Highest" changes nothing.',
  'The download folder is remembered between launches — set it once.',
  'A playlist becomes a single ZIP, numbered in playlist order.',
  'Private playlists work via Settings → Advanced using your own browser login.',
  'Update the downloader engine from Settings if YouTube changes something.'
]

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
const SHORTCUTS = [
  [`${mod}V`, 'paste a link from anywhere'],
  [`${mod},`, 'open settings'],
  ['Esc', 'close settings']
]

function Sparkline({ samples }: { samples: number[] }): React.JSX.Element {
  const data = samples.slice(-48)
  const max = Math.max(...data, 1)
  const pts = data.map((s, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${26 - (s / max) * 22}`)
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      {pts.length > 1 && (
        <>
          <polygon
            points={`0,28 ${pts.join(' ')} 100,28`}
            fill="var(--red)"
            opacity="0.08"
          />
          <polyline
            points={pts.join(' ')}
            fill="none"
            stroke="var(--red)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

const fmtBytes = (b: number): string =>
  b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`

/** Rotating info panel shown while a download runs. */
export function Widgets({ speedSamples }: { speedSamples: number[] }): React.JSX.Element {
  const [slot, setSlot] = useState(0)
  const [seed] = useState(() => Math.floor(Math.random() * 1000))
  const [todayStats, setTodayStats] = useState({ bytes: 0, files: 0 })

  useEffect(() => {
    const rotate = setInterval(() => setSlot((s) => s + 1), 8000)
    const refresh = (): void => {
      window.api.statsGet().then(setTodayStats)
    }
    refresh()
    const poll = setInterval(refresh, 5000)
    return () => {
      clearInterval(rotate)
      clearInterval(poll)
    }
  }, [])

  const current = speedSamples.at(-1) ?? 0
  const widgets: { icon: React.JSX.Element; label: string; body: React.JSX.Element }[] = [
    {
      icon: <Activity className="h-3.5 w-3.5" />,
      label: 'Transfer speed',
      body: (
        <div className="flex items-end gap-3">
          <span className="font-mono text-sm">{fmtSpeed(current)}</span>
          <div className="min-w-0 flex-1">
            <Sparkline samples={speedSamples} />
          </div>
        </div>
      )
    },
    {
      icon: <HardDrive className="h-3.5 w-3.5" />,
      label: 'Downloaded today',
      body: (
        <p className="text-sm">
          <span className="font-mono">{fmtBytes(todayStats.bytes)}</span>
          <span className="text-[var(--muted)]"> across </span>
          <span className="font-mono">{todayStats.files}</span>
          <span className="text-[var(--muted)]"> file{todayStats.files === 1 ? '' : 's'}</span>
        </p>
      )
    },
    {
      icon: <Sparkles className="h-3.5 w-3.5" />,
      label: 'Did you know',
      body: <p className="text-sm leading-relaxed">{FACTS[(seed + slot) % FACTS.length]}</p>
    },
    {
      icon: <Keyboard className="h-3.5 w-3.5" />,
      label: 'Shortcuts',
      body: (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {SHORTCUTS.map(([k, desc]) => (
            <span key={k} className="text-sm text-[var(--muted)]">
              <kbd className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--text)]">
                {k}
              </kbd>{' '}
              {desc}
            </span>
          ))}
        </div>
      )
    },
    {
      icon: <Lightbulb className="h-3.5 w-3.5" />,
      label: 'Tip',
      body: <p className="text-sm leading-relaxed">{TIPS[(seed + slot) % TIPS.length]}</p>
    }
  ]

  const w = widgets[slot % widgets.length]
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]/60 px-5 py-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={slot}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className="flex min-h-14 flex-col justify-center gap-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            {w.icon} {w.label}
          </span>
          {w.body}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
