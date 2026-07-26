import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Button, Spinner } from '../components/ui'
import PasswordInput from '../components/PasswordInput'

const MIN = 8

/**
 * Écran imposé après un clic sur le lien de réinitialisation: la session est
 * ouverte mais on ne laisse pas entrer avant d'avoir posé un nouveau mot de passe.
 */
export default function ResetPassword() {
  const { updatePassword, endRecovery, signOut } = useAuth()
  const { t } = useI18n()
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwd.length < MIN) return setError(t('pwd.tooShort'))
    if (pwd !== confirm) return setError(t('pwd.mismatch'))
    setLoading(true)
    setError(null)
    const { error } = await updatePassword(pwd)
    setLoading(false)
    if (error) setError(error)
    else endRecovery()
  }

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <h1 className="mb-4 text-center text-xl font-semibold">
          {t('pwd.newTitle')}
        </h1>
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
        {error && (
          <p className="text-center text-sm text-[var(--color-danger)]">{error}</p>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? <Spinner /> : t('pwd.save')}
        </Button>
        <button
          type="button"
          onClick={async () => {
            endRecovery()
            await signOut()
          }}
          className="w-full py-2 text-center text-sm text-[var(--color-muted)]"
        >
          {t('action.cancel')}
        </button>
      </form>
    </div>
  )
}
