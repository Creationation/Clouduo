import { useMemo, useRef } from 'react'
import { useQueue } from '../lib/queue'
import { useI18n } from '../lib/i18n'
import { Button, formatBytes } from '../components/ui'
import QueueList from '../components/QueueList'

export default function Backup() {
  const { add, items } = useQueue()
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)

  // Récap: fichiers sauvegardés (done + déjà présents) et volume.
  const recap = useMemo(() => {
    const finished = items.filter(
      (i) => i.status === 'done' || i.status === 'dedup',
    )
    const active = items.some(
      (i) => i.status !== 'done' && i.status !== 'dedup' && i.status !== 'error',
    )
    const bytes = finished.reduce((s, i) => s + i.size, 0)
    return { count: finished.length, bytes, active }
  }, [items])

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-2 text-xl font-semibold">{t('backup.title')}</h1>

      <Button onClick={() => input.current?.click()} className="w-full py-4">
        📥 {t('backup.cta')}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.length)
            add(e.target.files, { scope: 'personal' })
          e.target.value = ''
        }}
      />

      {/* Limitation PWA expliquée honnêtement */}
      <p className="mt-3 rounded-xl bg-[var(--color-surface)] p-3 text-xs leading-relaxed text-[var(--color-muted)]">
        {t('backup.note')}
      </p>

      {/* Récap une fois terminé */}
      {recap.count > 0 && !recap.active && (
        <div className="mt-4 rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-4 text-sm">
          <p className="font-medium">
            ✓ {recap.count}{' '}
            {recap.count > 1 ? t('common.files') : t('common.file')} — {formatBytes(recap.bytes)}
          </p>
          <p className="mt-1 text-[var(--color-muted)]">
            Tu peux maintenant libérer de l'espace sur ton téléphone.
          </p>
        </div>
      )}

      <QueueList />
    </div>
  )
}
