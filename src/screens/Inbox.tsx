import { useEffect, useState } from 'react'
import {
  listInbox,
  acceptTransfer,
  declineTransfer,
  type InboxTransfer,
} from '../lib/transfers'
import { signBatch } from '../lib/urls'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Button, EmptyState, Spinner, formatBytes } from '../components/ui'

export default function Inbox() {
  const { t } = useI18n()
  const [items, setItems] = useState<InboxTransfer[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const rows = await listInbox()
    setItems(rows)
    setLoading(false)
    const keys = rows.map((r) => r.file?.thumb_key).filter(Boolean) as string[]
    if (keys.length) signBatch(keys).then((m) => setThumbs((p) => ({ ...p, ...m })))
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel('inbox-screen')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transfers' },
        load,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const onAccept = async (id: string) => {
    setBusy(id)
    try {
      await acceptTransfer(id, null)
      await load()
    } finally {
      setBusy(null)
    }
  }
  const onDecline = async (id: string) => {
    setBusy(id)
    try {
      await declineTransfer(id)
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold">{t('inbox.title')}</h1>
      {loading ? (
        <div className="flex justify-center py-16 text-[var(--color-muted)]">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState>{t('inbox.empty')}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-2)]">
                {it.file?.thumb_key && thumbs[it.file.thumb_key] ? (
                  <img
                    src={thumbs[it.file.thumb_key]}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl">
                    {it.file?.kind === 'video' ? '🎬' : '🖼️'}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{it.file?.name ?? '—'}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {t('inbox.from')} {it.sender?.display_name ?? '—'}
                  {it.file ? ` · ${formatBytes(it.file.size_bytes)}` : ''}
                </p>
                {it.note && <p className="mt-1 text-xs italic">« {it.note} »</p>}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  onClick={() => onAccept(it.id)}
                  disabled={busy === it.id}
                  className="px-3 py-1.5 text-xs"
                >
                  {t('inbox.accept')}
                </Button>
                <button
                  onClick={() => onDecline(it.id)}
                  disabled={busy === it.id}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-muted)]"
                >
                  {t('inbox.decline')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
