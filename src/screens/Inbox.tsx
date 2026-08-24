import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listInbox,
  groupInbox,
  acceptBatch,
  declineBatch,
  acceptTransfer,
  declineTransfer,
  type InboxBatch,
  type InboxTransfer,
} from '../lib/transfers'
import { signBatch } from '../lib/urls'
import { setViewerList } from '../lib/viewerStore'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Button, EmptyState, Spinner, formatBytes } from '../components/ui'
import type { FileRow } from '../lib/types'

// Combien d'aperçus la bande repliée montre avant de proposer de déplier.
const PREVIEW = 6

function Thumb({
  file,
  url,
  onOpen,
  small,
}: {
  file: FileRow
  url?: string
  onOpen: () => void
  small?: boolean
}) {
  return (
    <button
      onClick={onOpen}
      className={`relative overflow-hidden rounded-lg bg-[var(--color-surface-2)] ${
        small ? 'h-16 w-16 shrink-0' : 'aspect-square w-full'
      }`}
      aria-label={file.name}
    >
      {url ? (
        <img src={url} className="h-full w-full object-cover" alt="" loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xl">
          {file.kind === 'video' ? '🎬' : file.kind === 'photo' ? '🖼️' : '📄'}
        </span>
      )}
      {file.kind === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/45 px-2 py-1 text-xs leading-none text-white">
            ▶
          </span>
        </span>
      )}
    </button>
  )
}

export default function Inbox() {
  const { t } = useI18n()
  const nav = useNavigate()
  const { show: toast } = useToast()
  const [batches, setBatches] = useState<InboxBatch[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    setLoadError(null)
    try {
      const rows = await listInbox()
      setBatches(groupInbox(rows))
      const keys = rows.map((r) => r.file?.thumb_key).filter(Boolean) as string[]
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

  // Ouvre la visionneuse sur le fichier cliqué, avec tout l'envoi comme
  // contexte: on fait défiler l'envoi au doigt sans revenir en arrière. Une
  // vidéo démarre d'elle-même, la visionneuse s'en charge.
  const openAt = (batch: InboxBatch, file: FileRow) => {
    setViewerList(batch.files)
    nav(`/view/inbox/${file.id}`)
  }

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key)
    try {
      await job()
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const onAcceptBatch = (b: InboxBatch) =>
    run(b.key, async () => {
      // folderId null: l'envoi arrive dans MON espace perso, pas dans le
      // Commun. Le Commun ne sert qu'aux fichiers déposés pour nous deux.
      const n = await acceptBatch(
        b.transfers.map((x) => x.id),
        null,
      )
      setAccepted((v) => v + n)
    })

  const onDeclineBatch = (b: InboxBatch) =>
    run(b.key, async () => {
      await declineBatch(b.transfers.map((x) => x.id))
    })

  const onAcceptOne = (tr: InboxTransfer) =>
    run(tr.id, async () => {
      await acceptTransfer(tr.id, null)
      setAccepted((v) => v + 1)
    })

  const onDeclineOne = (tr: InboxTransfer) =>
    run(tr.id, async () => {
      await declineTransfer(tr.id)
    })

  const urlOf = (f: FileRow) => (f.thumb_key ? thumbs[f.thumb_key] : undefined)

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold">{t('inbox.title')}</h1>

      {accepted > 0 && (
        <p className="page-in mb-4 rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-4 py-2.5 text-sm text-[var(--color-success)]">
          ✓ {accepted} · {t('inbox.accepted')}
        </p>
      )}

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
      ) : batches.length === 0 ? (
        <EmptyState>{t('inbox.empty')}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => {
            const count = b.transfers.length
            const expanded = !!open[b.key]
            const working = busy === b.key
            const strip = b.files.slice(0, PREVIEW)
            const rest = count - strip.length
            return (
              <li key={b.key} className="glass rounded-2xl p-3">
                {/* En-tête: qui, combien, quel poids */}
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm">
                    <strong>{b.senderName || t('inbox.from')}</strong>{' '}
                    {t('inbox.sentYou')} {count}{' '}
                    {count > 1 ? t('inbox.files') : t('inbox.file')}
                  </p>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">
                    {formatBytes(b.totalBytes)}
                  </span>
                </div>
                {b.note && <p className="mb-2 text-xs italic">« {b.note} »</p>}

                {/* Aperçus. Replié: une bande. Déplié: la grille complète. */}
                {expanded ? (
                  <ul className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {b.transfers.map((tr) => (
                      <li key={tr.id}>
                        {tr.file ? (
                          <>
                            <Thumb
                              file={tr.file}
                              url={urlOf(tr.file)}
                              onOpen={() => openAt(b, tr.file as FileRow)}
                            />
                            <p className="mt-1 truncate text-[10px] text-[var(--color-muted)]">
                              {tr.file.name}
                            </p>
                            <div className="mt-0.5 flex gap-1">
                              <button
                                onClick={() => onAcceptOne(tr)}
                                disabled={busy === tr.id}
                                className="flex-1 rounded bg-[var(--color-surface-2)] py-0.5 text-[10px]"
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => onDeclineOne(tr)}
                                disabled={busy === tr.id}
                                className="flex-1 rounded bg-[var(--color-surface-2)] py-0.5 text-[10px] text-[var(--color-muted)]"
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-[var(--color-surface-2)] p-1 text-center text-[10px] text-[var(--color-muted)]">
                            {t('inbox.gone')}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mb-3 flex gap-2 overflow-hidden">
                    {strip.map((f) => (
                      <Thumb
                        key={f.id}
                        file={f}
                        url={urlOf(f)}
                        small
                        onOpen={() => openAt(b, f)}
                      />
                    ))}
                    {rest > 0 && (
                      <button
                        onClick={() => setOpen((p) => ({ ...p, [b.key]: true }))}
                        className="h-16 w-16 shrink-0 rounded-lg bg-[var(--color-surface-2)] text-sm text-[var(--color-muted)]"
                      >
                        +{rest}
                      </button>
                    )}
                  </div>
                )}

                {/* Actions: tout l'envoi d'un coup, sans geste répété */}
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => onAcceptBatch(b)}
                    disabled={working}
                    className="flex-1 py-2 text-sm"
                  >
                    {working ? t('inbox.working') : t('inbox.acceptAll')}
                  </Button>
                  <button
                    onClick={() => onDeclineBatch(b)}
                    disabled={working}
                    className="rounded-xl px-3 py-2 text-sm text-[var(--color-muted)]"
                  >
                    {t('inbox.declineAll')}
                  </button>
                  {count > 1 && (
                    <button
                      onClick={() =>
                        setOpen((p) => ({ ...p, [b.key]: !expanded }))
                      }
                      className="rounded-xl px-2 py-2 text-xs text-[var(--color-muted)] underline"
                    >
                      {expanded ? t('inbox.hide') : t('inbox.seeAll')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
