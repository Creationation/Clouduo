import { useQueue } from '../lib/queue'
import { useI18n } from '../lib/i18n'
import { formatBytes } from './ui'
import type { QueueItem } from '../lib/db'

function StatusPill({ item }: { item: QueueItem }) {
  const { t } = useI18n()
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '…', cls: 'text-[var(--color-muted)]' },
    processing: { label: '⚙', cls: 'text-[var(--color-muted)]' },
    uploading: {
      label: `${Math.round(item.progress * 100)}%`,
      cls: 'text-[var(--color-accent)]',
    },
    paused: { label: '⏸', cls: 'text-[var(--color-muted)]' },
    done: { label: '✓', cls: 'text-[var(--color-success)]' },
    dedup: { label: t('upload.dedup'), cls: 'text-[var(--color-success)]' },
    error: { label: '⚠', cls: 'text-[var(--color-danger)]' },
  }
  const s = map[item.status] ?? map.pending
  return <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>
}

export default function QueueList() {
  const { items, pause, resume, retry, remove, clearFinished } = useQueue()
  const { t } = useI18n()
  if (items.length === 0) return null

  const anyFinished = items.some((i) => i.status === 'done' || i.status === 'dedup')

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-muted)]">
          {t('upload.queue')} ({items.length})
        </h2>
        {anyFinished && (
          <button
            onClick={clearFinished}
            className="text-xs text-[var(--color-muted)] underline"
          >
            {t('upload.done')}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.name}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {formatBytes(item.size)}
                  {item.error ? ` · ${item.error}` : ''}
                </p>
              </div>
              <StatusPill item={item} />
              <div className="flex gap-1">
                {item.status === 'uploading' && (
                  <button
                    onClick={() => pause(item.id)}
                    className="rounded-lg bg-[var(--color-surface-2)] px-2 py-1 text-xs"
                  >
                    {t('upload.pause')}
                  </button>
                )}
                {item.status === 'paused' && (
                  <button
                    onClick={() => resume(item.id)}
                    className="rounded-lg bg-[var(--color-surface-2)] px-2 py-1 text-xs"
                  >
                    {t('upload.resume')}
                  </button>
                )}
                {item.status === 'error' && (
                  <button
                    onClick={() => retry(item.id)}
                    className="rounded-lg bg-[var(--color-surface-2)] px-2 py-1 text-xs"
                  >
                    {t('upload.retry')}
                  </button>
                )}
                <button
                  onClick={() => remove(item.id)}
                  className="rounded-lg bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-muted)]"
                >
                  ✕
                </button>
              </div>
            </div>
            {(item.status === 'uploading' || item.status === 'paused') && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full bg-[var(--color-accent)] transition-all"
                  style={{ width: `${Math.round(item.progress * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
