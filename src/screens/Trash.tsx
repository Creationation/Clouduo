import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FileRow } from '../lib/types'
import { listTrash, restoreFile } from '../lib/files'
import { signBatch } from '../lib/urls'
import { invokeFunction } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Button, EmptyState, Spinner, formatBytes } from '../components/ui'
import { IconChevron, IconRestore, IconTrash } from '../components/icons'

export default function Trash() {
  const nav = useNavigate()
  const { t } = useI18n()
  const [items, setItems] = useState<FileRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // try/finally obligatoire: sans lui, un reseau coupe laissait un rond qui
  // tourne indefiniment, sans message ni moyen de reessayer.
  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await listTrash()
      setItems(rows)
      const keys = rows.map((r) => r.thumb_key).filter(Boolean) as string[]
      if (keys.length)
        signBatch(keys)
          .then((m) => setThumbs((p) => ({ ...p, ...m })))
          .catch(() => {})
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const onRestore = async (id: string) => {
    setBusy(id)
    try {
      await restoreFile(id)
      await load()
    } finally {
      setBusy(null)
    }
  }
  const onDeleteForever = async (id: string) => {
    if (!window.confirm(t('trash.deleteForever') + ' ?')) return
    setBusy(id)
    try {
      // L'Edge Function supprime la ligne puis l'objet R2 SI plus aucune référence.
      await invokeFunction('cleanup', { file_ids: [id] })
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => nav('/settings')} className="rounded-full bg-[var(--color-surface-2)] p-1.5">
          <IconChevron size={18} />
        </button>
        <h1 className="text-xl font-semibold">{t('trash.title')}</h1>
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">{t('trash.info')}</p>

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--color-muted)]">
          <Spinner />
        </div>
      ) : loadError ? (
        <div className="glass glass-menu mx-auto mt-6 max-w-sm rounded-2xl p-4 text-center">
          <p className="mb-1 text-sm font-semibold">{t('common.loadFailed')}</p>
          <p className="mb-3 break-words text-xs text-[var(--color-muted)]">
            {loadError}
          </p>
          <Button onClick={load} className="w-full">
            {t('upload.retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState>{t('trash.empty')}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-2)]">
                {f.thumb_key && thumbs[f.thumb_key] ? (
                  <img src={thumbs[f.thumb_key]} className="h-full w-full object-cover" alt="" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {f.kind === 'video' ? '🎬' : '🖼️'}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{f.name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {formatBytes(f.size_bytes)}
                </p>
              </div>
              <button
                onClick={() => onRestore(f.id)}
                disabled={busy === f.id}
                className="rounded-lg bg-[var(--color-surface-2)] p-2"
                title={t('trash.restore')}
              >
                <IconRestore size={18} />
              </button>
              <button
                onClick={() => onDeleteForever(f.id)}
                disabled={busy === f.id}
                className="rounded-lg bg-[var(--color-surface-2)] p-2 text-[var(--color-danger)]"
                title={t('trash.deleteForever')}
              >
                <IconTrash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
