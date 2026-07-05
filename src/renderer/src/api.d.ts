import type { Meta, Progress, JobResult } from '../../main/ytdlp'
import type { Settings } from '../../main/index'

export interface UpdateInfo {
  version: string
  notes: string
  url: string
  assets: { name: string; url: string }[]
}

declare global {
  interface Window {
    api: {
      settingsGet: () => Promise<Settings>
      settingsSet: (s: Settings) => Promise<void>
      pickFolder: () => Promise<string | null>
      pickCookies: () => Promise<string | null>
      readClipboard: () => Promise<string>
      info: (url: string, cookies: Pick<Settings, 'cookieMode' | 'cookiesFile'>) => Promise<Meta>
      start: (opts: Settings) => Promise<JobResult>
      cancel: () => Promise<void>
      retry: () => Promise<JobResult>
      zipPartial: () => Promise<string>
      openPath: (p: string) => Promise<void>
      ytdlpVersion: () => Promise<string>
      ytdlpUpdate: () => Promise<string>
      appVersion: () => Promise<string>
      appMeta: () => Promise<{ version: string; repoUrl: string }>
      statsGet: () => Promise<{ bytes: number; files: number }>
      updateCheck: () => Promise<UpdateInfo | null>
      updateInstall: (info: UpdateInfo) => Promise<void>
      openExternal: (url: string) => Promise<void>
      onProgress: (cb: (p: Progress) => void) => () => void
      onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void
    }
  }
}

export {}
