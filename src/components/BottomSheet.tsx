import type { ReactNode } from 'react'
import { useBackdropDismiss } from './overlay'
import Portal from './Portal'

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <Sheet onClose={onClose} title={title}>
      {children}
    </Sheet>
  )
}

// Contenu extrait dans son propre composant pour que le garde-fou du fond
// (voir useBackdropDismiss) reparte de zéro à chaque ouverture: il se règle au
// montage, et ce composant n'existe que pendant l'affichage.
function Sheet({
  onClose,
  title,
  children,
}: {
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  const backdrop = useBackdropDismiss(onClose)
  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      {...backdrop}
    >
      <div
        className="glass glass-menu safe-bottom w-full max-w-md rounded-t-3xl p-2"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <p className="truncate px-3 py-2 text-center text-xs text-[var(--color-muted)]">
            {title}
          </p>
        )}
        <div className="flex flex-col">{children}</div>
      </div>
    </div>
    </Portal>
  )
}

export function SheetButton({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-3 text-left text-sm active:bg-[var(--color-surface-2)] ${
        danger ? 'text-[var(--color-danger)]' : ''
      }`}
    >
      {children}
    </button>
  )
}
