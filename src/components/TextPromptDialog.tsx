import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { Button } from './ui'
import { useBackdropDismiss } from './overlay'
import Portal from './Portal'

/**
 * Remplace window.prompt, qui est peu fiable une fois l'app installée:
 * plusieurs WebView Android et certains contextes PWA le désactivent purement
 * et simplement, et le bouton semble alors ne rien faire.
 */
export default function TextPromptDialog({
  title,
  initial = '',
  placeholder,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: (value: string) => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const backdrop = useBackdropDismiss(onCancel)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (v) onConfirm(v)
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...backdrop}
    >
      <form
        onSubmit={submit}
        className="glass glass-menu w-full max-w-sm rounded-3xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none"
        />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            {confirmLabel ?? t('action.confirm')}
          </Button>
        </div>
      </form>
    </div>
    </Portal>
  )
}
