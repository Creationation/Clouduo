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
  dropBlob,
  pruneBlobs,
  putBlob,
  putItem,
  putItems,
  type QueueItem,
  type QueueStatus,
} from './db'
import { useI18n } from './i18n'
import { detectKind, resolveMime } from './media'
import { useToast } from './toast'
import { processItem } from './uploader'
import { invokeFunction } from './supabase'
import { uploadErrorKey } from './uploadErrors'
import type { Scope } from './types'

// Fichiers traités en parallèle. Chaque gros fichier ouvre en plus plusieurs
// parts simultanées (voir uploader.ts), d'où une valeur volontairement basse.
const CONCURRENCY = 3

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

const isFinished = (s: QueueStatus) => s === 'done' || s === 'dedup'

export function QueueProvider({ children }: { children: ReactNode }) {
  const { show: notify } = useToast()
  const { t } = useI18n()
  const itemsRef = useRef<QueueItem[]>([])
  // Une rafale d'échecs (le réseau qui saute au milieu de vingt photos) ne
  // doit pas empiler vingt bandeaux rouges: le premier est détaillé, la suite
  // est résumée en une ligne.
  const burst = useRef<{ n: number; timer: number | null }>({ n: 0, timer: null })
  const controllers = useRef<Map<string, AbortController>>(new Map())
  const running = useRef<Set<string>>(new Set())
  const pausedIds = useRef<Set<string>>(new Set())
  const [, setVersion] = useState(0)
  const rerender = () => setVersion((v) => v + 1)

  // Charger la file persistée au démarrage; relancer ce qui était en cours.
  useEffect(() => {
    // D'abord rendre l'espace des octets qui ne servent plus (envois déjà
    // terminés, lignes disparues): sans ça le stockage du site grossit à
    // chaque envoi et finit par refuser d'écrire.
    pruneBlobs()
      .catch(() => {})
      .then(allItems)
      .then((items) => {
        for (const it of items) {
          if (it.status === 'uploading' || it.status === 'processing') {
            it.status = 'pending' // reprendre proprement
          }
          // Un envoi non terminé dont les octets ont disparu ne peut pas
          // reprendre. On le dit au lieu de le laisser tourner dans le vide.
          if (!it.file && !isFinished(it.status)) {
            it.status = 'error'
            it.error = 'fichier introuvable, a resélectionner'
            putItem(it)
          }
        }
        itemsRef.current = items
        rerender()
        pump()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // N'écrit QUE les métadonnées: les octets sont à part et ne bougent plus.
  const persist = (it: QueueItem) => putItem(it)

  // Un envoi terminé n'a plus besoin de ses octets: on les rend tout de suite,
  // sans attendre que quelqu'un vide la liste à la main.
  const releaseBytes = (it: QueueItem) => {
    if (!isFinished(it.status)) return
    it.file = undefined
    it.thumbBlob = undefined
    dropBlob(it.id).catch(() => {})
  }

  const makeUpdate = (item: QueueItem) => async (patch: Partial<QueueItem>) => {
    Object.assign(item, patch)
    await persist(item)
    releaseBytes(item)
    rerender()
  }

  const setStatus = (item: QueueItem, status: QueueStatus, error?: string) => {
    item.status = status
    if (error !== undefined) item.error = error
    persist(item)
    releaseBytes(item)
    rerender()
  }

  const reportError = (name: string, msg: string) => {
    const key = uploadErrorKey(msg)
    const b = burst.current
    b.n += 1
    if (b.n === 1) notify?.(`${name} · ${key ? t(key) : msg}`, 'error')
    if (b.timer) clearTimeout(b.timer)
    b.timer = window.setTimeout(() => {
      if (b.n > 1) notify?.(`${b.n} ${t('upload.errMany')}`, 'error')
      b.n = 0
      b.timer = null
    }, 4000)
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
        const msg = e instanceof Error ? e.message : String(e)
        setStatus(item, 'error', msg)
        // Une erreur d'envoi restait invisible tant qu'on ne regardait pas la
        // file: on la remonte à l'écran, quel que soit l'onglet affiché.
        reportError(item.name, msg)
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
    const created: QueueItem[] = []
    for (const file of Array.from(files)) {
      const mime = resolveMime(file)
      created.push({
        id: uuid(),
        file,
        name: file.name,
        size: file.size,
        mime,
        kind: detectKind(mime),
        scope: opts.scope,
        folderId: opts.folderId ?? null,
        status: 'pending',
        progress: 0,
        sendToUserId: opts.sendToUserId,
        note: opts.note,
        createdAt: Date.now(),
      })
    }
    itemsRef.current.push(...created)
    // Une seule transaction: ajouter un dossier de milliers de fichiers doit
    // rester instantané. Les lignes sont légères, les octets suivent à part.
    await putItems(created)
    rerender()
    pump()
    // Les octets, une fois chacun, uniquement pour pouvoir reprendre après
    // fermeture de l'app. Si le stockage refuse (téléphone plein), l'envoi
    // part quand même: il ne sera simplement pas reprenable. Jamais de blocage.
    for (const it of created) {
      if (!it.file || isFinished(it.status)) continue
      try {
        await putBlob(it.id, it.file)
        // Un petit fichier peut être arrivé avant qu'on ait fini de l'écrire:
        // dans ce cas ses octets ne servent déjà plus à rien.
        if (isFinished(it.status)) await dropBlob(it.id)
      } catch {
        /* pas de reprise possible pour celui-là, l'envoi continue */
      }
    }
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
    const finished = itemsRef.current.filter((i) => isFinished(i.status))
    finished.forEach((i) => deleteItem(i.id))
    itemsRef.current = itemsRef.current.filter((i) => !isFinished(i.status))
    rerender()
  }

  const activeCount = itemsRef.current.filter(
    (i) => !isFinished(i.status) && i.status !== 'error',
  ).length

  // Sur Android, l'écran qui s'éteint suspend la WebView: l'envoi s'arrête et
  // ne reprend qu'au réveil. Sur un gros fichier en 4G, ça donne l'impression
  // que l'app traîne alors qu'elle est simplement gelée. On garde donc
  // l'écran allumé tant qu'il reste quelque chose à envoyer, et pas une
  // seconde de plus (la veille se rétablit dès la file vide).
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
        /* refus possible si l'onglet n'est pas au premier plan */
      }
    }
    acquire()
    // Le verrou saute dès que la page passe en arrière-plan: on le reprend.
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
