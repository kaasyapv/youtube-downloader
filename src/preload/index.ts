import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  settingsGet: () => invoke('settings:get'),
  settingsSet: (s: unknown) => invoke('settings:set', s),
  pickFolder: () => invoke('pick:folder'),
  pickCookies: () => invoke('pick:cookies'),
  readClipboard: () => invoke('clipboard:read'),
  info: (url: string, cookies: unknown) => invoke('info', url, cookies),
  start: (opts: unknown) => invoke('download:start', opts),
  cancel: () => invoke('download:cancel'),
  retry: () => invoke('download:retry'),
  zipPartial: () => invoke('download:zip-partial'),
  openPath: (p: string) => invoke('open:path', p),
  ytdlpVersion: () => invoke('ytdlp:version'),
  ytdlpUpdate: () => invoke('ytdlp:update'),
  appVersion: () => invoke('app:version'),
  appMeta: () => invoke('app:meta'),
  statsGet: () => invoke('stats:get'),
  updateCheck: () => invoke('update:check'),
  updateInstall: (info: unknown) => invoke('update:install', info),
  openExternal: (url: string) => invoke('open:external', url),
  onProgress: (cb: (p: unknown) => void) => {
    const f = (_e: unknown, p: unknown): void => cb(p)
    ipcRenderer.on('progress', f)
    return () => ipcRenderer.removeListener('progress', f)
  },
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const f = (_e: unknown, i: unknown): void => cb(i)
    ipcRenderer.on('update-available', f)
    return () => ipcRenderer.removeListener('update-available', f)
  }
})
