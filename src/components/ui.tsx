import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: {
  variant?: 'primary' | 'ghost' | 'danger'
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'glass-accent hover:brightness-110',
    ghost:
      'bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-border)]',
    danger: 'glass-danger hover:brightness-110',
  }[variant]
  return (
    <button
      className={`flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function formatBytes(n: number): string {
  if (!n) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-[var(--color-muted)]">
      {children}
    </div>
  )
}
