import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Sans ce garde-fou, la moindre exception pendant un rendu ou dans un
 * useEffect démonte tout l'arbre React et laisse un écran ENTIÈREMENT vide,
 * sans le moindre indice — arrivé sur le téléphone le 2026-07-27 à cause d'un
 * plugin natif absent, impossible à diagnostiquer depuis l'appareil.
 *
 * On affiche désormais le message d'erreur et un bouton pour repartir.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur non rattrapée:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="safe-top flex min-h-full items-center justify-center p-6">
        <div className="glass w-full max-w-sm rounded-2xl p-5">
          <h1 className="mb-2 text-base font-semibold">Une erreur est survenue</h1>
          <p className="mb-4 break-words text-xs text-[var(--color-muted)]">
            {error.message || String(error)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-xl bg-[var(--color-surface-2)] px-4 py-3 text-sm"
            >
              Réessayer
            </button>
            <button
              onClick={() => {
                // Dernier recours: vider le cache applicatif et recharger.
                // Un service worker périmé a déjà provoqué ce genre de blocage.
                if ('caches' in window) {
                  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
                }
                navigator.serviceWorker
                  ?.getRegistrations()
                  .then((rs) => rs.forEach((r) => r.unregister()))
                  .finally(() => window.location.reload())
              }}
              className="glass-accent rounded-xl px-4 py-3 text-sm"
            >
              Recharger
            </button>
          </div>
        </div>
      </div>
    )
  }
}
