import * as React from 'react'
import { cn } from '../../lib/utils'

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'flex h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:border-[var(--red)]/60 focus-visible:ring-2 focus-visible:ring-[var(--red)]/20 transition-[border-color,box-shadow] select-text no-drag',
        className
      )}
      {...props}
    />
  )
}
