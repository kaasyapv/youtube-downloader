import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export function Progress({
  value,
  className
}: {
  value: number
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]', className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-[var(--red-deep)] to-[#ff3b30]"
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      />
    </div>
  )
}
