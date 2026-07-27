import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, ms?: number) => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

const DEFAULT_MS = 5000
const MAX_VISIBLE = 3

/**
 * Canal pour signaler une erreur depuis du code hors React (gestionnaires
 * globaux, modules utilitaires). Sans lui, une panne survenue en dehors d'un
 * composant resterait totalement muette.
 */
const CHANNEL = 'clouduo:toast'
export function reportError(message: string) {
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: message }))
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback(
    (message: string, kind: ToastKind = 'info', ms = DEFAULT_MS) => {
      const id = nextId.current++
      setToasts((prev) => {
        // Un message identique déjà affiché n'est pas empilé: pendant un lot
        // d'envois, la même erreur peut se répéter des dizaines de fois.
        if (prev.some((t) => t.message === message)) return prev
        return [...prev, { id, kind, message }].slice(-MAX_VISIBLE)
      })
      window.setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        ms,
      )
    },
    [],
  )

  /**
   * Filet de dernier recours. Une promesse rejetée sans catch ou une erreur
   * JavaScript ne casse pas forcément l'affichage, mais laisse l'app dans un
   * état incohérent SANS que l'utilisateur en sache rien: bouton qui ne
   * répond pas, liste qui ne se charge jamais. On les remonte toutes.
   */
  useEffect(() => {
    const onCustom = (e: Event) => show((e as CustomEvent<string>).detail, 'error')
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const msg = r instanceof Error ? r.message : String(r ?? 'erreur inconnue')
      console.error('Promesse rejetée sans traitement:', r)
      show(msg, 'error')
    }
    const onError = (e: ErrorEvent) => {
      console.error('Erreur JavaScript:', e.error ?? e.message)
      show(e.message || 'erreur inattendue', 'error')
    }
    window.addEventListener(CHANNEL, onCustom)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener(CHANNEL, onCustom)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [show])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Au-dessus de la barre du bas, sous les dialogues (z-50). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[45] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`page-in glass glass-menu pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3 text-sm shadow-lg ${
              t.kind === 'error'
                ? 'text-[var(--color-danger)]'
                : t.kind === 'success'
                  ? 'text-[var(--color-success)]'
                  : t.kind === 'warning'
                    ? 'text-[var(--color-warning)]'
                    : 'text-[var(--color-text)]'
            }`}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.kind === 'error' && '⚠ '}
            {t.kind === 'success' && '✓ '}
            {t.kind === 'warning' && '⚠ '}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}
