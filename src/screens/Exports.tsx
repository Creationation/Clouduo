import { useExports } from '../lib/exports'
import { useI18n, type TKey } from '../lib/i18n'
import { isApp } from '../lib/saveFile'
import { Button, EmptyState, Spinner } from '../components/ui'
import type { ExportItem } from '../lib/db'

function Pill({ item, t }: { item: ExportItem; t: (k: TKey) => string }) {
  const base = 'text-xs font-medium'
  if (item.status === 'running')
    return <Spinner className="h-4 w-4 text-[var(--color-accent)]" />
  if (item.status === 'pending')
    return <span className={`${base} text-[var(--color-muted)]`}>…</span>
  if (item.status === 'error')
    return <span className={`${base} text-[var(--color-danger)]`}>⚠</span>
  return (
    <span className={`${base} text-[var(--color-success)]`}>
      ✓{' '}
      {item.where === 'gallery'
        ? t('exports.inGallery')
        : item.where === 'downloads'
          ? t('exports.inDownloads')
          : ''}
    </span>
  )
}

/**
 * Les enregistrements demandés: ce qui attend, ce qui part, ce qui est arrivé.
 *
 * Un enregistrement ne dépend plus de l'écran depuis lequel il a été lancé:
 * on peut continuer à naviguer, la file avance toute seule et se retrouve
 * ici. Elle est reprise telle quelle à la réouverture de l'application.
 */
export default function Exports() {
  const { items, retry, remove, clearFinished, activeCount } = useExports()
  const { t } = useI18n()

  const finished = items.some((i) => i.status === 'done' || i.status === 'error')

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('exports.title')}</h1>
        {finished && (
          <button
            onClick={clearFinished}
            className="text-xs text-[var(--color-muted)] underline"
          >
            {t('exports.clear')}
          </button>
        )}
      </div>
      <p className="mb-5 text-sm text-[var(--color-muted)]">
        {isApp() ? t('exports.introApp') : t('exports.introWeb')}
      </p>

      {activeCount > 0 && (
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          {activeCount} {t('exports.remaining')}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState>{t('exports.empty')}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="glass flex items-center gap-3 rounded-xl p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{it.name}</p>
                {it.error && (
                  <p className="truncate text-xs text-[var(--color-danger)]">
                    {it.error}
                  </p>
                )}
              </div>
              <Pill item={it} t={t} />
              {it.status === 'error' && (
                <Button
                  variant="ghost"
                  onClick={() => retry(it.id)}
                  className="shrink-0 px-3 py-1.5 text-xs"
                >
                  {t('upload.retry')}
                </Button>
              )}
              <button
                onClick={() => remove(it.id)}
                aria-label="✕"
                className="shrink-0 px-2 text-xs text-[var(--color-muted)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
