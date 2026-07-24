import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  allItems,
  deleteItem,
  putItem,
  type QueueItem,
  type QueueStatus,
} from './db'
import { detectKind } from './media'
import { processItem } from './uploader'
import { invokeFunction } from './supabase'
import type { Scope } from './types'

const CONCURRENCY = 2

interface AddOptions {
  scope: Scope
  folderId?: string | null
  sendToUserId?: string
  note?: string
}

interface QueueContextValue {
  items: QueueItem[]
  add: (files: File[] | FileList, opts: AddOptions) => Promise<void>
  pause: (id: string) => void
  resume: (id: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  clearFinished: () => void
  activeCount: number
}

const QueueContext = createContext<QueueContextValue>({} as QueueContextValue)

function uuid() {
  return crypto.randomUUID()
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const itemsRef = useRef<QueueItem[]>([])
  const controllers = useRef<Map<string, AbortController>>(new Map())
  const running = useRef<Set<string>>(new Set())
  const pausedIds = useRef<Set<string>>(new Set())
  const [, setVersion] = useState(0)
  const rerender = () => setVersion((v) => v + 1)

  // Charger la file persistée au démarrage; relancer ce qui était en cours.
  useEffect(() => {
    allItems().then((items) => {
      for (const it of items) {
        if (it.status === 'uploading' || it.status === 'processing') {
          it.status = 'pending' // reprendre proprement
        }
      }
      itemsRef.current = items
      rerender()
      pump()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (it: QueueItem) => putItem(it)

  const makeUpdate = (item: QueueItem) => async (patch: Partial<QueueItem>) => {
    Object.assign(item, patch)
    await persist(item)
    rerender()
  }

  const setStatus = (item: QueueItem, status: QueueStatus, error?: string) => {
    item.status = status
    if (error !== undefined) item.error = error
    persist(item)
    rerender()
  }

  const start = async (item: QueueItem) => {
    running.current.add(item.id)
    const controller = new AbortController()
    controllers.current.set(item.id, controller)
    try {
      await processItem(item, makeUpdate(item), controller.signal)
    } catch (e) {
      if (controller.signal.aborted) {
        // Abort volontaire: pause si demandée, sinon l'item a été retiré.
        if (pausedIds.current.has(item.id)) setStatus(item, 'paused')
      } else {
        setStatus(item, 'error', e instanceof Error ? e.message : String(e))
      }
    } finally {
      running.current.delete(item.id)
      controllers.current.delete(item.id)
      pump()
    }
  }

  // Ordonnanceur: démarre des items 'pending' dans la limite de CONCURRENCY.
  const pump = () => {
    for (const item of itemsRef.current) {
      if (running.current.size >= CONCURRENCY) break
      if (
        item.status === 'pending' &&
        !running.current.has(item.id) &&
        !pausedIds.current.has(item.id)
      ) {
        start(item)
      }
    }
  }

  const add: QueueContextValue['add'] = async (files, opts) => {
    const arr = Array.from(files)
    for (const file of arr) {
      const item: QueueItem = {
        id: uuid(),
        file,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        kind: detectKind(file.type || ''),
        scope: opts.scope,
        folderId: opts.folderId ?? null,
        status: 'pending',
        progress: 0,
        sendToUserId: opts.sendToUserId,
        note: opts.note,
        createdAt: Date.now(),
      }
      itemsRef.current.push(item)
      await persist(item)
    }
    rerender()
    pump()
  }

  const pause = (id: string) => {
    pausedIds.current.add(id)
    const c = controllers.current.get(id)
    if (c) c.abort()
    else {
      const it = itemsRef.current.find((i) => i.id === id)
      if (it) setStatus(it, 'paused')
    }
  }

  const resume = (id: string) => {
    pausedIds.current.delete(id)
    const it = itemsRef.current.find((i) => i.id === id)
    if (it) {
      it.status = 'pending'
      persist(it)
      rerender()
      pump()
    }
  }

  const retry = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id)
    if (it) {
      it.status = 'pending'
      it.error = undefined
      persist(it)
      rerender()
      pump()
    }
  }

  const remove = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id)
    const c = controllers.current.get(id)
    if (c) c.abort()
    // Best-effort: annuler un multipart entamé côté R2.
    if (it?.uploadId && it.r2_key) {
      invokeFunction('sign-upload', {
        action: 'multipart-abort',
        r2_key: it.r2_key,
        uploadId: it.uploadId,
      }).catch(() => {})
    }
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id)
    deleteItem(id)
    rerender()
  }

  const clearFinished = () => {
    const finished = itemsRef.current.filter(
      (i) => i.status === 'done' || i.status === 'dedup',
    )
    finished.forEach((i) => deleteItem(i.id))
    itemsRef.current = itemsRef.current.filter(
      (i) => i.status !== 'done' && i.status !== 'dedup',
    )
    rerender()
  }

  const activeCount = itemsRef.current.filter(
    (i) => i.status !== 'done' && i.status !== 'dedup' && i.status !== 'error',
  ).length

  return (
    <QueueContext.Provider
      value={{
        items: itemsRef.current,
        add,
        pause,
        resume,
        retry,
        remove,
        clearFinished,
        activeCount,
      }}
    >
      {children}
    </QueueContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useQueue() {
  return useContext(QueueContext)
}
