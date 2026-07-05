import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50 disabled:pointer-events-none disabled:opacity-40 cursor-pointer no-drag',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-b from-[#ff3b30] to-[var(--red-deep)] text-white shadow-[0_2px_16px_-2px_rgba(255,45,85,0.45)] hover:brightness-110',
        secondary:
          'bg-[var(--panel-2)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--border)]',
        ghost: 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]'
      },
      size: {
        default: 'h-10 px-5',
        lg: 'h-12 px-8 text-base',
        sm: 'h-8 px-3 text-xs',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
