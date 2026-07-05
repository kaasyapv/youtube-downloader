import { Activity } from 'lucide-react'
import { fmtSpeed } from './lib/utils'

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

/** Live transfer-speed graph shown while a download runs. */
export function Widgets({ speedSamples }: { speedSamples: number[] }): React.JSX.Element {
  const current = speedSamples.at(-1) ?? 0
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]/60 px-5 py-4">
      <div className="flex min-h-14 flex-col justify-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          <Activity className="h-3.5 w-3.5" /> Transfer speed
        </span>
        <div className="flex items-end gap-3">
          <span className="font-mono text-sm">{fmtSpeed(current)}</span>
          <div className="min-w-0 flex-1">
            <Sparkline samples={speedSamples} />
          </div>
        </div>
      </div>
    </div>
  )
}
