import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import type { Lang } from '../lib/types'
import { Button, Spinner } from '../components/ui'
import PasswordInput from '../components/PasswordInput'
import Logo from '../components/Logo'
import { FlagFR, FlagAT } from '../components/Flags'

const LANGS: { code: Lang; label: string; Flag: typeof FlagFR }[] = [
  { code: 'fr', label: 'Français', Flag: FlagFR },
  { code: 'de', label: 'Deutsch', Flag: FlagAT },
]

export default function Login({
  expiredRecovery = false,
}: {
  /** On arrive d'un lien de réinitialisation périmé: on l'explique et on
   *  ouvre directement le formulaire de demande. */
  expiredRecovery?: boolean
}) {
  const { signIn, requestPasswordReset } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgot, setForgot] = useState(expiredRecovery)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(username, password)
    if (error) setError(error === 'too_many' ? t('login.tooMany') : t('login.error'))
    setLoading(false)
  }

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await requestPasswordReset(username)
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-3xl p-6">
        <div className="mb-8 text-center">
          <Logo size={64} className="mx-auto mb-4 rounded-2xl shadow-lg" />
          <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t('login.title')}
          </p>
        </div>

        {/* Choix de la langue dès l'ouverture, avant même de se connecter. */}
        <div className="mb-6 flex justify-center gap-2">
          {LANGS.map(({ code, label, Flag }) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm transition ${
                lang === code
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]'
              }`}
            >
              <Flag
                size={22}
                className="rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
              />
              {label}
            </button>
          ))}
        </div>

        {forgot ? (
          // --- Mot de passe oublié: le lien part sur l'email du compte ---
          <form onSubmit={sendReset} className="space-y-3">
            {expiredRecovery && !sent && (
              <p className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2.5 text-sm text-[var(--color-danger)]">
                {t('login.linkExpired')}
              </p>
            )}
            <p className="text-sm text-[var(--color-muted)]">
              {t('login.forgotHint')}
            </p>
            <input
              autoComplete="username"
              placeholder={t('login.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {sent && (
              <p className="rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-4 py-2.5 text-sm text-[var(--color-success)]">
                ✓ {t('login.forgotSent')}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Spinner /> : t('login.forgotSend')}
            </Button>
            <button
              type="button"
              onClick={() => {
                setForgot(false)
                setSent(false)
              }}
              className="w-full py-2 text-center text-sm text-[var(--color-muted)]"
            >
              {t('login.backToLogin')}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              autoComplete="username"
              placeholder={t('login.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder={t('login.password')}
            />
            {error && (
              <p className="text-center text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Spinner /> : t('login.submit')}
            </Button>
            <button
              type="button"
              onClick={() => setForgot(true)}
              className="w-full py-2 text-center text-sm text-[var(--color-muted)]"
            >
              {t('login.forgot')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
