import { useState } from 'react'
import type { FileRow } from '../lib/types'
import { updateFileInfo, isoToLocalInput, localInputToIso } from '../lib/files'
import { useI18n } from '../lib/i18n'
import { Button, Spinner } from './ui'

/**
 * Édition du nom et de la date d'un fichier. La date pilote le classement
 * chronologique de la galerie; l'original stocké n'est jamais touché.
 */
export default function FileEditDialog({
  file,
  onClose,
  onSaved,
}: {
  file: FileRow
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(file.name)
  const [date, setDate] = useState(isoToLocalInput(file.taken_at ?? file.created_at))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const iso = localInputToIso(date)
    if (!iso) {
      setError(t('edit.badDate'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateFileInfo(file.id, { name: trimmed, taken_at: iso })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-sm rounded-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">{t('edit.title')}</h2>

        <label className="mb-1 block text-xs text-[var(--color-muted)]">
          {t('edit.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none"
        />

        <label className="mb-1 block text-xs text-[var(--color-muted)]">
          {t('edit.date')}
        </label>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none"
        />
        <p className="mt-1.5 text-xs text-[var(--color-muted)]">{t('edit.dateHint')}</p>

        {error && (
          <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('action.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Spinner /> : t('action.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
