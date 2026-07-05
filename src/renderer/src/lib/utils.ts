import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function fmtDuration(s: number): string {
  if (!s) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtSpeed(bps: number | null): string {
  if (!bps) return '—'
  const mb = bps / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`
}

export function fmtSize(b: number): string {
  const gb = b / 1073741824
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`
}

export function fmtEta(s: number | null): string {
  if (s == null) return '—'
  return fmtDuration(Math.round(s)) || '0:00'
}
