import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, ClipboardPaste, Download, Folder, FolderOpen, ListVideo, Loader2,
  RotateCcw, Settings2, User, X, Archive
} from 'lucide-react'
import type { Meta, Progress as Prog, JobResult } from '../../main/ytdlp'
import type { Settings } from '../../main/index'
import type { UpdateInfo } from './api'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Progress } from './components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { SettingsPanel } from './SettingsPanel'
import { Widgets } from './Widgets'
import { cn, fmtDuration, fmtEta, fmtSize, fmtSpeed } from './lib/utils'

const QUALITY_LABELS: Record<string, string> = {
  highest: 'Highest', '2160': '4K', '1440': '1440p',
  '1080': '1080p', '720': '720p', '480': '480p', '360': '360p'
}

type Phase = 'idle' | 'fetching' | 'ready' | 'working' | 'done' | 'partial' | 'cancelled'

const card = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18 }
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState('')
  const [prog, setProg] = useState<Prog | null>(null)
  const [result, setResult] = useState<JobResult | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsAdvanced, setSettingsAdvanced] = useState(false)
  const [versions, setVersions] = useState({ app: '', ytdlp: '' })
  const [repoUrl, setRepoUrl] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [speedSamples, setSpeedSamples] = useState<number[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fetchSeq = useRef(0)

  useEffect(() => {
    window.api.settingsGet().then(setSettings)
    window.api.appMeta().then((m) => {
      setRepoUrl(m.repoUrl)
      setVersions((v) => ({ ...v, app: m.version }))
    })
    window.api.ytdlpVersion().then((ytdlp) => setVersions((v) => ({ ...v, ytdlp })))
    const offUpdate = window.api.onUpdateAvailable(setUpdate)
    const offProgress = window.api.onProgress((p) => {
      setProg(p)
      if (p.stage === 'downloading' && p.speed) {
        setSpeedSamples((s) => [...s.slice(-59), p.speed as number])
      }
    })
    return () => {
      offUpdate()
      offProgress()
    }
  }, [])

  // keyboard shortcuts: ⌘/Ctrl+, settings · Esc close · ⌘/Ctrl+V paste anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = e.metaKey || e.ctrlKey
      if (cmd && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      } else if (e.key === 'Escape') {
        setShowSettings(false)
      } else if (cmd && e.key === 'v' && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') {
        paste()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  const save = useCallback((s: Settings) => {
    setSettings(s)
    window.api.settingsSet(s)
  }, [])

  const lookup = useCallback(
    (raw: string, cookies: Pick<Settings, 'cookieMode' | 'cookiesFile'>) => {
      const seq = ++fetchSeq.current
      setError('')
      setMeta(null)
      if (!raw.trim()) {
        setPhase('idle')
        return
      }
      setPhase('fetching')
      window.api
        .info(raw.trim(), cookies)
        .then((m) => {
          if (seq !== fetchSeq.current) return
          setMeta(m)
          setPhase('ready')
        })
        .catch((e: Error) => {
          if (seq !== fetchSeq.current) return
          setError(e.message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''))
          setPhase('idle')
        })
    },
    []
  )

  function onUrlChange(raw: string): void {
    setUrl(raw)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => settings && lookup(raw, settings), 450)
  }

  async function paste(): Promise<void> {
    const text = await window.api.readClipboard()
    setUrl(text)
    if (settings) lookup(text, settings)
  }

  async function start(run: () => Promise<JobResult>): Promise<void> {
    setPhase('working')
    setResult(null)
    setProg(null)
    setSpeedSamples([])
    try {
      const r = await run()
      setResult(r)
      if (r.status === 'done') setPhase('done')
      else if (r.status === 'partial') setPhase('partial')
      else if (r.status === 'cancelled') setPhase('cancelled')
      else {
        setError(r.error ?? 'Download failed')
        setPhase('ready')
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''))
      setPhase('ready')
    }
  }

  async function zipPartial(): Promise<void> {
    try {
      const zip = await window.api.zipPartial()
      setResult((r) => (r ? { ...r, outputPath: zip, status: 'done' } : r))
      setPhase('done')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function reset(): void {
    setUrl('')
    setMeta(null)
    setProg(null)
    setResult(null)
    setError('')
    setPhase('idle')
  }

  if (!settings) return <div className="h-screen bg-[var(--bg)]" />

  const failed = result?.results.filter((r) => !r.ok && r.error !== 'cancelled') ?? []
  const succeeded = result?.results.filter((r) => r.ok) ?? []
  const working = phase === 'working'

  // duration × bitrate heuristic (MB/min); exact sizes need per-video probes
  const MB_MIN: Record<string, number> = {
    '360': 4, '480': 7, '720': 13, '1080': 25, '1440': 45, '2160': 85, highest: 85
  }
  const estBytes = meta
    ? (meta.totalDuration / 60) * (settings.format === 'mp3' ? 2.4 : (MB_MIN[settings.quality] ?? 25)) * 1048576
    : 0
  const skipSummary = meta && meta.unavailable.length > 0
    ? Object.entries(
        meta.unavailable.reduce<Record<string, number>>(
          (a, u) => ((a[u.reason] = (a[u.reason] ?? 0) + 1), a), {}
        )
      ).map(([r, n]) => `${n} ${r}`).join(' · ')
    : ''

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--bg)]">
      <div className="pointer-events-none absolute inset-0 bg-grid" />
      <div className="pointer-events-none absolute inset-0 bg-noise" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 glow-red" />

      {/* title bar */}
      <header className="drag relative z-10 flex items-center justify-between px-5 pt-4 pb-2">
        <div className="w-16" />
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#ff3b30] to-[var(--red-deep)] shadow-[0_0_24px_rgba(255,45,85,0.5)]">
            <svg width="11" height="12" viewBox="0 0 11 12" fill="white" aria-hidden>
              <path d="M0 0 L11 6 L0 12 Z" />
            </svg>
          </div>
          <h1 className="text-sm font-semibold tracking-tight">YouTube Downloader</h1>
        </div>
        <div className="w-16 flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-xl flex-col gap-4 px-6 pt-6">
        {/* update banner */}
        <AnimatePresence>
          {update && !updateDismissed && (
            <motion.div
              key="update"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--red)]/25 bg-[var(--red)]/8 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm">New version available</p>
                <p className="font-mono text-xs text-[var(--muted)]">
                  Current: v{versions.app} → Latest: v{update.version}
                </p>
                {update.notes && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{update.notes}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => window.api.updateInstall(update)}>
                  Update Now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setUpdateDismissed(true)}>
                  Later
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* URL input */}
        <div className="relative">
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Paste a YouTube video, Short, or playlist link"
            spellCheck={false}
            disabled={working}
          />
          <Button
            variant="secondary"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={paste}
            disabled={working}
          >
            <ClipboardPaste className="h-3.5 w-3.5" /> Paste
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div key="err" {...card} className="flex items-center justify-between gap-3">
              <p className="text-sm text-[#ff6b6b]">{error}</p>
              {/private|sign ?in|log ?in|members|account/i.test(error) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setSettingsAdvanced(true)
                    setShowSettings(true)
                  }}
                >
                  Choose login…
                </Button>
              )}
            </motion.div>
          )}

          {phase === 'fetching' && (
            <motion.div key="fetch" {...card} className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up…
            </motion.div>
          )}

          {/* metadata + controls */}
          {meta && (phase === 'ready' || working) && (
            <motion.div key="meta" {...card} className="flex flex-col gap-4">
              <div className="flex gap-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                {meta.thumbnail && (
                  <img
                    src={meta.thumbnail}
                    alt=""
                    className="h-24 w-40 shrink-0 rounded-xl object-cover"
                  />
                )}
                <div className="min-w-0 flex flex-col justify-center gap-1">
                  <p className="truncate font-medium leading-snug" title={meta.title}>
                    {meta.title}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                    <User className="h-3.5 w-3.5" /> {meta.uploader}
                    {meta.kind === 'video' && meta.duration > 0 && (
                      <span>· {fmtDuration(meta.duration)}</span>
                    )}
                  </p>
                  {meta.kind === 'playlist' && (
                    <>
                      <p className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                        <ListVideo className="h-3.5 w-3.5" /> {meta.count} videos · saved as one ZIP
                      </p>
                      {skipSummary && (
                        <p className="text-xs text-[#ffb86b]">
                          {skipSummary} — will be skipped
                        </p>
                      )}
                      <p className="text-xs text-[var(--muted)]">
                        Playlist ID verified: <span className="font-mono">{meta.id}</span> — confirm
                        this is the one you intended.
                      </p>
                    </>
                  )}
                  {estBytes > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      {meta.kind === 'playlist' ? 'Estimated Total Size' : 'Estimated Size'}: ~
                      {fmtSize(estBytes)} · Estimated Free Space Required: ~{fmtSize(estBytes * 2)}{' '}
                      (estimate)
                    </p>
                  )}
                </div>
              </div>

              {!working && (
                <>
                  <div className="flex items-center gap-3">
                    {/* MP4 / MP3 segmented toggle */}
                    <div className="flex rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1">
                      {(['mp4', 'mp3'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => save({ ...settings, format: f })}
                          className={cn(
                            'relative rounded-lg px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                            settings.format === f ? 'text-white' : 'text-[var(--muted)] hover:text-[var(--text)]'
                          )}
                        >
                          {settings.format === f && (
                            <motion.span
                              layoutId="fmt"
                              className="absolute inset-0 rounded-lg bg-gradient-to-b from-[#ff3b30] to-[var(--red-deep)]"
                              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                            />
                          )}
                          <span className="relative uppercase">{f}</span>
                        </button>
                      ))}
                    </div>

                    <Select
                      value={settings.quality}
                      onValueChange={(q) => save({ ...settings, quality: q })}
                      disabled={settings.format === 'mp3'}
                    >
                      <SelectTrigger className={settings.format === 'mp3' ? 'opacity-40' : ''}>
                        <SelectValue>{QUALITY_LABELS[settings.quality]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(QUALITY_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="secondary"
                      className="min-w-0 flex-1 justify-start"
                      onClick={async () => {
                        const dir = await window.api.pickFolder()
                        if (dir) save({ ...settings, dir })
                      }}
                      title={settings.dir}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="truncate">{settings.dir.split(/[\\/]/).pop() || settings.dir}</span>
                    </Button>
                  </div>

                  <motion.div whileTap={{ scale: 0.985 }}>
                    <Button size="lg" className="w-full" onClick={() => start(() => window.api.start(settings))}>
                      <Download className="h-5 w-5" />
                      Download {meta.kind === 'playlist' ? `${meta.count} videos` : settings.format.toUpperCase()}
                    </Button>
                  </motion.div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* progress */}
        <AnimatePresence>
          {working && (
            <motion.div
              key="prog"
              {...card}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5"
            >
              {meta && meta.count > 1 && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--muted)]">Overall</span>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {prog ? `${prog.itemIndex} / ${prog.itemCount}` : `0 / ${meta.count}`}
                    </span>
                  </div>
                  <Progress value={prog?.overallPercent ?? 0} />
                </>
              )}
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="min-w-0 truncate text-[var(--muted)]">
                  {prog?.stage === 'zipping'
                    ? 'Creating ZIP…'
                    : prog?.stage === 'retrying'
                      ? `Retrying (${prog.attempt}/3)… — ${prog.itemTitle}`
                      : prog?.stage === 'converting'
                        ? `Converting — ${prog.itemTitle}`
                        : prog?.itemTitle || 'Starting…'}
                </span>
                <span className="shrink-0 font-mono text-xs text-[var(--muted)]">
                  {prog?.stage === 'downloading' && `${fmtSpeed(prog.speed)} · ETA ${fmtEta(prog.eta)}`}
                </span>
              </div>
              <Progress value={prog?.percent ?? 0} />
              <Button variant="secondary" size="sm" className="self-end" onClick={() => window.api.cancel()}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </motion.div>
          )}

          {/* rotating widgets fill the space below while downloading */}
          {working && (
            <motion.div key="widgets" {...card}>
              <Widgets speedSamples={speedSamples} />
            </motion.div>
          )}

          {/* done */}
          {phase === 'done' && result && (
            <motion.div
              key="done"
              {...card}
              className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8"
            >
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15"
              >
                <Check className="h-6 w-6 text-emerald-400" />
              </motion.div>
              <p className="font-medium">Download Complete</p>
              {meta?.kind === 'playlist' && (
                <p className="-mt-2 text-sm text-[var(--muted)]">
                  Downloaded: {succeeded.length} · Skipped: {meta.unavailable.length} · Failed:{' '}
                  {failed.length}
                </p>
              )}
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => window.api.openPath(result.outputPath)}>
                  <FolderOpen className="h-4 w-4" /> Open Folder
                </Button>
                <Button onClick={reset}>Download Another</Button>
              </div>
            </motion.div>
          )}

          {/* partial failure */}
          {phase === 'partial' && result && (
            <motion.div
              key="partial"
              {...card}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5"
            >
              <p className="text-sm font-medium">
                Downloaded: {succeeded.length} · Skipped: {meta?.unavailable.length ?? 0} · Failed:{' '}
                {failed.length}
              </p>
              <ul className="max-h-36 overflow-y-auto text-sm text-[var(--muted)]">
                {failed.map((f) => (
                  <li key={f.id} className="flex gap-2 py-0.5">
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff6b6b]" />
                    <span className="min-w-0">
                      <span className="text-[var(--text)]">{f.title}</span>
                      {f.error && <span> — {f.error}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => start(() => window.api.retry())}>
                  <RotateCcw className="h-4 w-4" /> Retry failed
                </Button>
                {succeeded.length > 0 && (
                  <Button onClick={zipPartial}>
                    <Archive className="h-4 w-4" /> ZIP {succeeded.length} successful
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {phase === 'cancelled' && (
            <motion.div key="cancelled" {...card} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
              <p className="text-sm text-[var(--muted)]">Download cancelled.</p>
              <Button variant="secondary" size="sm" onClick={reset}>
                Start over
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            settings={settings}
            save={save}
            versions={versions}
            repoUrl={repoUrl}
            advancedOpen={settingsAdvanced}
            onClose={() => {
              setShowSettings(false)
              setSettingsAdvanced(false)
            }}
            onYtdlpUpdated={(ytdlp) => setVersions((v) => ({ ...v, ytdlp }))}
            onUpdateFound={(info) => {
              setUpdate(info)
              setUpdateDismissed(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
