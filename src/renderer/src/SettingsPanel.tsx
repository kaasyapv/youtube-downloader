import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, FileText, Github, RefreshCw, X } from 'lucide-react'
import type { Settings } from '../../main/index'
import type { UpdateInfo } from './api'
import { Button } from './components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'

const COOKIE_LABELS: Record<string, string> = {
  none: 'No login',
  chrome: 'Chrome cookies',
  safari: 'Safari cookies',
  firefox: 'Firefox cookies',
  edge: 'Edge cookies',
  brave: 'Brave cookies',
  file: 'cookies.txt file'
}

export function SettingsPanel({
  settings,
  save,
  versions,
  repoUrl,
  advancedOpen,
  onClose,
  onYtdlpUpdated,
  onUpdateFound
}: {
  settings: Settings
  save: (s: Settings) => void
  versions: { app: string; ytdlp: string }
  repoUrl: string
  advancedOpen?: boolean
  onClose: () => void
  onYtdlpUpdated: (v: string) => void
  onUpdateFound: (info: UpdateInfo) => void
}): React.JSX.Element {
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const [advanced, setAdvanced] = useState(advancedOpen ?? false)
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState('')

  async function updateYtdlp(): Promise<void> {
    setUpdating(true)
    setUpdateMsg('')
    try {
      const v = await window.api.ytdlpUpdate()
      setUpdateMsg(`Updated to ${v}`)
      onYtdlpUpdated(v)
    } catch (e) {
      setUpdateMsg((e as Error).message)
    } finally {
      setUpdating(false)
    }
  }

  async function checkAppUpdate(): Promise<void> {
    setChecking(true)
    setCheckMsg('')
    try {
      const info = await window.api.updateCheck()
      if (info) {
        setCheckMsg(`Version ${info.version} available`)
        onUpdateFound(info)
      } else {
        setCheckMsg('You’re up to date')
      }
    } catch (e) {
      setCheckMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="fixed right-0 top-0 z-50 flex h-full w-[350px] flex-col gap-7 border-l border-[var(--border)] bg-[var(--panel)] p-6"
        initial={{ x: 370 }}
        animate={{ x: 0 }}
        exit={{ x: 370 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Theme
          </label>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <Button
                key={t}
                variant={settings.theme === t ? 'default' : 'secondary'}
                size="sm"
                onClick={() => save({ ...settings, theme: t })}
              >
                {t === 'dark' ? 'Dark' : 'Light'}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Downloader engine
          </label>
          <Button variant="secondary" size="sm" onClick={updateYtdlp} disabled={updating}>
            <RefreshCw className={`h-3.5 w-3.5 ${updating ? 'animate-spin' : ''}`} />
            {updating ? 'Updating…' : 'Update Downloader'}
          </Button>
          {updateMsg && <p className="text-xs text-[var(--muted)]">{updateMsg}</p>}
        </div>

        {/* Advanced: login for private videos, hidden by default */}
        <div className="flex flex-col gap-2.5">
          <button
            className="flex cursor-pointer items-center gap-1 text-xs font-medium uppercase tracking-wider text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            onClick={() => setAdvanced(!advanced)}
          >
            <motion.span animate={{ rotate: advanced ? 90 : 0 }} transition={{ duration: 0.15 }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.span>
            Advanced
          </button>
          <AnimatePresence initial={false}>
            {advanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-2 overflow-hidden"
              >
                <label className="text-xs text-[var(--muted)]">
                  Private videos &amp; playlists
                </label>
                <Select
                  value={settings.cookieMode}
                  onValueChange={(v) => save({ ...settings, cookieMode: v as Settings['cookieMode'] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{COOKIE_LABELS[settings.cookieMode]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COOKIE_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {settings.cookieMode === 'file' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const f = await window.api.pickCookies()
                      if (f) save({ ...settings, cookiesFile: f })
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {settings.cookiesFile ? settings.cookiesFile.split(/[\\/]/).pop() : 'Choose cookies.txt'}
                  </Button>
                )}
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  Uses your own browser login. Your password is never asked for or stored.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between">
            <button
              className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              onClick={() => window.api.openExternal(repoUrl)}
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </button>
            <span className="font-mono text-xs text-[var(--muted)]">
              v{versions.app} · yt-dlp {versions.ytdlp}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={checkAppUpdate} disabled={checking}>
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check for Updates'}
          </Button>
          {checkMsg && <p className="text-xs text-[var(--muted)]">{checkMsg}</p>}
        </div>
      </motion.aside>
    </>
  )
}
