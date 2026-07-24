import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Button, Spinner } from '../components/ui'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email.trim(), password)
    if (error) setError(t('login.error'))
    setLoading(false)
  }

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-3xl">
            ☁️
          </div>
          <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t('login.title')}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('login.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder={t('login.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {error && (
            <p className="text-center text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <Spinner /> : t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
