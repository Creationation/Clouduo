import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n, type Lang } from '../lib/i18n'
import { Button, Spinner, formatBytes } from '../components/ui'
import PasswordInput from '../components/PasswordInput'
import { useTheme } from '../lib/theme'
import { IconSun, IconMoon } from '../components/icons'
import { FlagFR, FlagAT } from '../components/Flags'

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
  const { theme, setTheme } = useTheme()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)

  useEffect(() => {
    // Les statistiques sont secondaires: leur échec ne doit pas empêcher
    // d'accéder à la langue, au thème ou au mot de passe.
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('get_storage_stats')
        if (error) throw error
        setStats(data as Stats)
      } catch {
        setStatsFailed(true)
      }
    })()
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
      <section className="glass mb-5 rounded-2xl p-4">
        <h2 className="mb-1 text-sm font-semibold">{t('settings.storage')}</h2>
        {statsFailed ? (
          <p className="py-4 text-center text-sm text-[var(--color-muted)]">
            {t('common.loadFailed')}
          </p>
        ) : !stats ? (
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
        className="glass mb-5 w-full rounded-xl p-4 text-left text-sm"
      >
        🗑 {t('settings.trashLink')}
      </button>

      {/* Langue */}
      <section className="glass mb-5 rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.lang')}</h2>
        <div className="inline-flex rounded-lg bg-[var(--color-surface-2)] p-1">
          {([
            { code: 'fr' as Lang, label: 'Français', Flag: FlagFR },
            { code: 'de' as Lang, label: 'Deutsch', Flag: FlagAT },
          ]).map(({ code, label, Flag }) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm ${
                lang === code ? 'glass-accent' : 'text-[var(--color-muted)]'
              }`}
            >
              <Flag
                size={20}
                className="rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
              />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Apparence */}
      <section className="glass mb-5 rounded-2xl p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.theme')}</h2>
        <div className="inline-flex rounded-lg bg-[var(--color-surface-2)] p-1">
          {([
            { key: 'light' as const, Icon: IconSun, label: t('theme.light') },
            { key: 'dark' as const, Icon: IconMoon, label: t('theme.dark') },
          ]).map(({ key, Icon, label }) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition ${
                theme === key
                  ? 'glass-accent'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Mot de passe */}
      <ChangePassword />

      <Button variant="danger" onClick={signOut} className="w-full">
        {t('settings.logout')}
      </Button>
    </div>
  )
}

const MIN = 8

// Changement de mot de passe: la session en cours suffit à autoriser la
// modification côté Supabase, on demande donc juste une confirmation.
function ChangePassword() {
  const { t } = useI18n()
  const { updatePassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDone(false)
    if (pwd.length < MIN) return setError(t('pwd.tooShort'))
    if (pwd !== confirm) return setError(t('pwd.mismatch'))
    setLoading(true)
    setError(null)
    const { error } = await updatePassword(pwd)
    setLoading(false)
    if (error) return setError(error)
    setPwd('')
    setConfirm('')
    setDone(true)
    setOpen(false)
  }

  return (
    <section className="glass mb-5 rounded-2xl p-4">
      <h2 className="mb-2 text-sm font-semibold">{t('pwd.title')}</h2>

      {done && (
        <p className="mb-3 rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]">
          ✓ {t('pwd.changed')}
        </p>
      )}

      {open ? (
        <form onSubmit={submit} className="space-y-3">
          <PasswordInput
            value={pwd}
            onChange={setPwd}
            placeholder={t('pwd.new')}
            autoComplete="new-password"
          />
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            placeholder={t('pwd.confirm')}
            autoComplete="new-password"
          />
          <p className="text-xs text-[var(--color-muted)]">{t('pwd.rule')}</p>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Spinner /> : t('pwd.save')}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)} className="w-full">
          {t('pwd.change')}
        </Button>
      )}
    </section>
  )
}
