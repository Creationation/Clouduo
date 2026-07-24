import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n, type Lang } from '../lib/i18n'
import { Button, Spinner, formatBytes } from '../components/ui'

interface Bucket {
  bytes: number
  count: number
}
interface Stats {
  mine: Bucket
  shared: Bucket
  trash: Bucket
  physical_total: Bucket
  per_user?: {
    id: string
    display_name: string
    personal_bytes: number
    personal_count: number
  }[]
}

function StatRow({ label, b }: { label: string; b: Bucket }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <span className="text-sm text-[var(--color-muted)]">
        {formatBytes(b.bytes)} · {b.count}
      </span>
    </div>
  )
}

export default function Settings() {
  const nav = useNavigate()
  const { profile, signOut } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    supabase.rpc('get_storage_stats').then(({ data }) => setStats(data as Stats))
  }, [])

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-1 text-xl font-semibold">{t('settings.title')}</h1>
      {profile && (
        <p className="mb-5 text-sm text-[var(--color-muted)]">
          {profile.display_name}
          {profile.role === 'owner' ? ' · owner' : ''}
        </p>
      )}

      {/* Stockage */}
      <section className="mb-5 rounded-2xl bg-[var(--color-surface)] p-4">
        <h2 className="mb-1 text-sm font-semibold">{t('settings.storage')}</h2>
        {!stats ? (
          <div className="py-6 text-center text-[var(--color-muted)]">
            <Spinner />
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            <StatRow label={t('settings.mine')} b={stats.mine} />
            <StatRow label={t('settings.shared')} b={stats.shared} />
            <StatRow label={t('settings.trash')} b={stats.trash} />
            <StatRow label={t('settings.total')} b={stats.physical_total} />

            {/* Détail par utilisateur (owner uniquement) */}
            {stats.per_user && (
              <div className="pt-2">
                <p className="py-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Détail
                </p>
                {stats.per_user.map((u) => (
                  <StatRow
                    key={u.id}
                    label={u.display_name}
                    b={{ bytes: u.personal_bytes, count: u.personal_count }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Corbeille */}
      <button
        onClick={() => nav('/trash')}
        className="mb-5 w-full rounded-xl bg-[var(--color-surface)] p-4 text-left text-sm"
      >
        🗑 {t('settings.trashLink')}
      </button>

      {/* Langue */}
      <section className="mb-5 rounded-2xl bg-[var(--color-surface)] p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.lang')}</h2>
        <div className="inline-flex rounded-lg bg-[var(--color-surface-2)] p-1">
          {(['fr', 'de'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-md px-4 py-1.5 text-sm uppercase ${
                lang === l ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </section>

      <Button variant="danger" onClick={signOut} className="w-full">
        {t('settings.logout')}
      </Button>
    </div>
  )
}
