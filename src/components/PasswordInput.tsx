import { useState } from 'react'
import { IconEye, IconEyeOff } from './icons'

/** Champ mot de passe avec l'œil pour révéler ce qu'on tape. */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  required = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete?: string
  required?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 pr-12 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Masquer' : 'Afficher'}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-[var(--color-muted)] transition hover:text-[var(--color-text)]"
      >
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  )
}
