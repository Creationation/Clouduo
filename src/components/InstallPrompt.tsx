import { useEffect, useState } from 'react'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

// Bannière d'installation (Android/PC). iOS ne supporte pas beforeinstallprompt:
// l'ajout à l'écran d'accueil s'y fait via Partager > Sur l'écran d'accueil.
export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [hidden, setHidden] = useState(
    () => localStorage.getItem('installDismissed') === '1',
  )

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIPEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!evt || hidden) return null

  const dismiss = () => {
    localStorage.setItem('installDismissed', '1')
    setHidden(true)
  }

  return (
    <div className="mx-auto mb-2 flex max-w-2xl items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <span className="text-2xl">☁️</span>
      <p className="flex-1 text-xs text-[var(--color-muted)]">
        Installe Clouduo sur ton écran d'accueil.
      </p>
      <button
        onClick={async () => {
          await evt.prompt()
          await evt.userChoice
          setEvt(null)
        }}
        className="glass-accent rounded-lg px-3 py-1.5 text-xs"
      >
        Installer
      </button>
      <button onClick={dismiss} className="px-1 text-[var(--color-muted)]">
        ✕
      </button>
    </div>
  )
}
