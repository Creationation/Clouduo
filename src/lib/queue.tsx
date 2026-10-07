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
import { runExclusive } from './lane'
import { processItem } from './uploader'
import { invokeFunction, supabase } from './supabase'
import { errorText, uploadErrorKey } from './uploadErrors'
import type { Scope } from './types'

// Un fichier à la fois. Trois envois simultanés ne vont pas plus vite (la
// bande passante du téléphone est la même), mais multiplient les délais
// d'attente, les URL signées qui expirent pendant qu'on patiente, et les
// échecs sans cause apparente. Un gros fichier ouvre de toute façon plusieurs
// parts en parallèle à l'intérieur de son propre envoi (voir uploader.ts).
const CONCURRENCY = 1

// Une coupure réseau ne doit pas transformer un envoi en échec définitif.
// L'app est souvent en fond, sur un téléphone qui change de wifi ou perd la
// 4G: on repart tout seul, en espaçant les tentatives, et on ne dérange
// l'utilisateur que si on finit par abandonner.
const RETRY_MAX = 6
const retryDelay = (n: number) => Math.min(60_000, 1000 * 2 ** n)
// Session expirée pendant que l'app dormait, ou URL signée périmée (HTTP 403):
// une nouvelle session et une nouvelle signature suffisent presque toujours.
const AUTH_RETRY_MAX = 2

// Copie de sécurité des octets (pour reprendre après fermeture de l'app).
// Sans limite, deux cents fichiers dont des vidéos de plusieurs centaines de
// Mo étaient TOUS recopiés dans le stockage du site, en même temps que les
// envois lisaient ces mêmes fichiers: le téléphone saturait, le stockage du
// site refusait d'écrire et les envois tombaient en erreur rouge. Au-delà de
// ces seuils, l'envoi part sans copie: il ne survivra pas à une fermeture de
// l'app, mais il n'abîme plus rien.
const BLOB_MAX_FILE = 300 * 1024 * 1024
const BLOB_MAX_TOTAL = 1.5 * 1024 ** 3

async function roomForBlob(size: number): Promise<boolean> {
  if (size > BLOB_MAX_FILE) return false
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est?.quota) return true
    const usage = est.usage ?? 0
    return usage + size < Math.min(BLOB_MAX_TOTAL, est.quota * 0.5)
  } catch {
    return true
  }
}

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
  // Envois en attente d'une nouvelle tentative: ils restent 'pending' à
  // l'écran (donc sans bandeau rouge) mais l'ordonnanceur les laisse dormir
  // jusqu'à l'échéance ou jusqu'au retour du réseau.
  const waiting = useRef<Set<string>>(new Set())
  const retries = useRef<Map<string, number>>(new Map())
  const timers = useRef<Map<string, number>>(new Map())
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
  //
  // Une écriture refusée (stockage du site plein) ne doit JAMAIS faire échouer
  // l'envoi lui-même: la file vit en mémoire, le disque ne sert qu'à reprendre
  // après fermeture. Avant, la barre de progression qui n'arrivait pas à
  // s'écrire faisait tomber un envoi qui se passait bien.
  const persist = (it: QueueItem) => putItem(it).catch(() => {})

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
      // File commune aux envois et aux enregistrements: chacun son tour,
      // dans l'ordre où il a été demandé.
      await runExclusive(() =>
        processItem(item, makeUpdate(item), controller.signal),
      )
    } catch (e) {
      if (controller.signal.aborted) {
        // Abort volontaire: pause si demandée, sinon l'item a été retiré.
        if (pausedIds.current.has(item.id)) setStatus(item, 'paused')
      } else {
        const msg = errorText(e)
        const n = retries.current.get(item.id) ?? 0
        const kind = uploadErrorKey(msg)
        // Perte de réseau: on retentera. Session expirée: on la renouvelle et
        // on retente, deux fois au plus. Manque de place ou fichier disparu
        // ne se règlent pas en réessayant, donc on s'arrête.
        const retryable =
          (kind === 'upload.errNet' && n < RETRY_MAX) ||
          (kind === 'upload.errAuth' && n < AUTH_RETRY_MAX)
        if (retryable) {
          if (kind === 'upload.errAuth') {
            await supabase.auth.refreshSession().catch(() => {})
          }
          retries.current.set(item.id, n + 1)
          waiting.current.add(item.id)
          item.status = 'pending'
          item.error = undefined
          persist(item)
          rerender()
          const timer = window.setTimeout(() => {
            timers.current.delete(item.id)
            waiting.current.delete(item.id)
            pump()
          }, retryDelay(n))
          timers.current.set(item.id, timer)
        } else {
          setStatus(item, 'error', msg)
          // Une erreur d'envoi restait invisible tant qu'on ne regardait pas
          // la file: on la remonte à l'écran, quel que soit l'onglet affiché.
          reportError(item.name, msg)
        }
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
        !pausedIds.current.has(item.id) &&
        !waiting.current.has(item.id)
      ) {
        start(item)
      }
    }
  }

  const add: QueueContextValue['add'] = async (files, opts) => {
    const created: QueueItem[] = []
    // Le sélecteur Android peut revenir sans rien (photo seulement dans le
    // cloud de la galerie): sans ce message, rien ne bougeait et l'écran
    // continuait d'afficher le résumé vert des envois précédents.
    if (files.length === 0) {
      notify?.(t('upload.emptyPick'), 'error')
      return
    }
    // Un identifiant par sélection: c'est ce qui permet à la boîte de
    // réception de présenter « 20 fichiers » en un seul envoi plutôt qu'en
    // vingt cartes à traiter une par une.
    const batchId = opts.sendToUserId ? uuid() : undefined
    for (const file of Array.from(files)) {
      const mime = resolveMime(file)
      // Zéro octet: le téléphone a donné un nom sans contenu. Inutile de
      // l'envoyer, on le dit tout de suite au lieu de créer un fichier vide.
      const empty = file.size === 0
      created.push({
        id: uuid(),
        file,
        name: file.name,
        size: file.size,
        mime,
        kind: detectKind(mime),
        scope: opts.scope,
        folderId: opts.folderId ?? null,
        status: empty ? 'error' : 'pending',
        error: empty ? 'fichier vide' : undefined,
        progress: 0,
        sendToUserId: opts.sendToUserId,
        note: opts.note,
        batchId,
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
      if (!it.file || isFinished(it.status) || it.status === 'error') continue
      if (!(await roomForBlob(it.file.size))) continue
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
    clearWait(id)
    const it = itemsRef.current.find((i) => i.id === id)
    if (it) {
      it.status = 'pending'
      persist(it)
      rerender()
      pump()
    }
  }

  const clearWait = (id: string) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    waiting.current.delete(id)
  }

  const retry = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id)
    // Demande explicite: on repart de zéro, sans traîner le compteur de
    // tentatives automatiques.
    retries.current.delete(id)
    clearWait(id)
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
    clearWait(id)
    retries.current.delete(id)
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

  // Reprise automatique. Sur telephone l'app passe son temps en arriere-plan:
  // la WebView est gelee, les requetes en vol meurent, et au retour rien ne
  // repartait tant qu'on ne touchait pas un bouton. Le retour du reseau ou du
  // premier plan est un bien meilleur signal qu'un minuteur: on annule les
  // attentes en cours et on relance tout de suite.
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

  // Fermer l'onglet au milieu d'un envoi ne perd rien (la file est persistee)
  // mais interrompt le transfert en cours: sur ordinateur on previent.
  useEffect(() => {
    if (activeCount === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [activeCount])

  // Aucun minuteur ne doit survivre au demontage.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

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
