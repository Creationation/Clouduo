import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  allExports,
  deleteExport,
  putExport,
  putExports,
  type ExportItem,
} from './db'
import { runExclusive } from './lane'
import { saveFile, AppTooOldError } from './saveFile'
import { useI18n } from './i18n'
import { useToast } from './toast'
import { errorText, uploadErrorKey } from './uploadErrors'
import type { FileRow } from './types'

interface ExportContextValue {
  items: ExportItem[]
  /** Met des fichiers en file d'enregistrement. Rend la main aussitôt. */
  add: (files: FileRow[]) => Promise<void>
  retry: (id: string) => void
  remove: (id: string) => void
  clearFinished: () => void
  activeCount: number
}

const ExportContext = createContext<ExportContextValue>({} as ExportContextValue)

const isFinished = (s: ExportItem['status']) => s === 'done' || s === 'error'

// Comme les envois: une coupure reseau au milieu de 200 enregistrements ne
// doit pas laisser une colonne d'erreurs rouges. On reessaie tout seul, en
// espacant, et on n'abandonne qu'apres plusieurs echecs.
const RETRY_MAX = 6
const retryDelay = (n: number) => Math.min(60_000, 2000 * 2 ** n)

/**
 * File des enregistrements (cloud vers téléphone).
 *
 * Vit au niveau de l'application: naviguer d'un écran à l'autre, ou fermer
 * l'écran d'où l'enregistrement a été lancé, n'interrompt rien. Chaque
 * travail passe par la file commune (voir lane.ts), donc à la suite des
 * envois en cours et jamais en même temps qu'eux.
 */
export function ExportProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { show: notify } = useToast()
  const itemsRef = useRef<ExportItem[]>([])
  const running = useRef(false)
  const retries = useRef<Map<string, number>>(new Map())
  const waiting = useRef<Set<string>>(new Set())
  const timers = useRef<Map<string, number>>(new Map())
  const [, setVersion] = useState(0)
  const rerender = () => setVersion((v) => v + 1)

  const persist = (it: ExportItem) => putExport(it)

  // Au démarrage: un enregistrement interrompu par la fermeture de l'app
  // repart de zéro (rien n'a été écrit sur le téléphone, ou l'entrée à moitié
  // écrite a été retirée côté natif).
  useEffect(() => {
    allExports().then((items) => {
      for (const it of items) {
        if (it.status === 'running') {
          it.status = 'pending'
          persist(it)
        }
      }
      itemsRef.current = items
      rerender()
      pump()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pump = () => {
    if (running.current) return
    const next = itemsRef.current.find(
      (i) => i.status === 'pending' && !waiting.current.has(i.id),
    )
    if (!next) return
    running.current = true
    void runExclusive(async () => {
      next.status = 'running'
      await persist(next)
      rerender()
      try {
        const where = await saveFile({
          name: next.name,
          r2_key: next.r2_key,
          mime_type: next.mime,
          taken_at: next.takenAt,
        })
        next.status = 'done'
        next.where = where
        next.error = undefined
        retries.current.delete(next.id)
      } catch (e) {
        const msg = errorText(e)
        const n = retries.current.get(next.id) ?? 0
        if (
          !(e instanceof AppTooOldError) &&
          uploadErrorKey(msg) === 'upload.errNet' &&
          n < RETRY_MAX
        ) {
          // Reseau: le travail reste en attente, sans bandeau rouge.
          retries.current.set(next.id, n + 1)
          waiting.current.add(next.id)
          next.status = 'pending'
          next.error = undefined
          await persist(next)
          rerender()
          const id = next.id
          timers.current.set(
            id,
            window.setTimeout(() => {
              timers.current.delete(id)
              waiting.current.delete(id)
              pump()
            }, retryDelay(n)),
          )
          return
        }
        next.status = 'error'
        next.error =
          e instanceof AppTooOldError
            ? t('file.appTooOld')
            : e instanceof Error
              ? e.message
              : String(e)
        // Une application trop ancienne ne se corrigera pas au fichier
        // suivant: on le dit une fois, fort, au lieu de laisser défiler
        // cinquante échecs identiques.
        if (e instanceof AppTooOldError) {
          for (const it of itemsRef.current) {
            if (it.status === 'pending') {
              it.status = 'error'
              it.error = t('file.appTooOld')
              void persist(it)
            }
          }
          notify?.(t('file.appTooOld'), 'error', 9000)
        }
      }
      await persist(next)
      rerender()
    }).finally(() => {
      running.current = false
      pump()
    })
  }

  const add: ExportContextValue['add'] = async (files) => {
    const created: ExportItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      fileId: f.id,
      name: f.name,
      r2_key: f.r2_key,
      mime: f.mime_type,
      takenAt: f.taken_at,
      status: 'pending',
      createdAt: Date.now(),
    }))
    if (!created.length) return
    itemsRef.current.push(...created)
    await putExports(created)
    rerender()
    pump()
  }

  const clearWait = (id: string) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    waiting.current.delete(id)
  }

  const retry = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id)
    if (!it) return
    retries.current.delete(id)
    clearWait(id)
    it.status = 'pending'
    it.error = undefined
    persist(it)
    rerender()
    pump()
  }

  const remove = (id: string) => {
    clearWait(id)
    retries.current.delete(id)
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id)
    deleteExport(id)
    rerender()
  }

  const clearFinished = () => {
    for (const it of itemsRef.current) if (isFinished(it.status)) deleteExport(it.id)
    itemsRef.current = itemsRef.current.filter((i) => !isFinished(i.status))
    rerender()
  }

  const activeCount = itemsRef.current.filter((i) => !isFinished(i.status)).length

  // Comme pour les envois: l'écran qui s'éteint gèle la page, et un
  // enregistrement en cours s'arrête au milieu. On garde l'écran allumé tant
  // qu'il reste du travail, et pas une seconde de plus.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> }
    const wl = (
      navigator as unknown as {
        wakeLock?: { request: (t: 'screen') => Promise<Sentinel> }
      }
    ).wakeLock
    if (!wl || activeCount === 0) return
    let lock: Sentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const s = await wl.request('screen')
        if (cancelled) await s.release()
        else lock = s
      } catch {
        /* refus possible si la page n'est pas au premier plan */
      }
    }
    acquire()
    const onVisible = () => {
      if (!document.hidden && !lock) acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [activeCount])

  // Retour du réseau ou du premier plan: on relance sans attendre.
  useEffect(() => {
    const wake = () => {
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
      waiting.current.clear()
      pump()
    }
    const onVisible = () => {
      if (!document.hidden) wake()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ExportContext.Provider
      value={{
        items: itemsRef.current,
        add,
        retry,
        remove,
        clearFinished,
        activeCount,
      }}
    >
      {children}
    </ExportContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useExports() {
  return useContext(ExportContext)
}
