import {
  createContext,
  useCallback,
  useContext,
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
