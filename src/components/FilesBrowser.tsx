import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import type { FileRow, FileKind, Folder, Scope } from '../lib/types'
import {
  listFiles,
  listFolders,
  createFolder,
  trashFile,
  copyFile,
  moveToShared,
  type KindFilter,
} from '../lib/files'
import { signBatch, downloadOriginal } from '../lib/urls'
import { createTransfer } from '../lib/transfers'
import { setViewerList } from '../lib/viewerStore'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import FileTile from './FileTile'
import BottomSheet, { SheetButton } from './BottomSheet'
import FileEditDialog from './FileEditDialog'
import MoveDialog from './MoveDialog'
import TextPromptDialog from './TextPromptDialog'
import {
  IconFolder,
  IconChevron,
  IconDoc,
  IconCheck,
  IconMove,
  IconSend,
  IconShared,
  IconTrash,
} from './icons'
import { Button, EmptyState, Spinner, formatBytes } from './ui'

// media = galerie photos/vidéos, documents = tout le reste (kind 'other').
export type BrowserMode = 'media' | 'documents'

interface Crumb {
  id: string | null
  name: string
}

/**
 * Regroupement par JOUR et non par mois: c'est l'unité à laquelle on pense
 * ses photos ("la sortie de dimanche"), et ça rend la sélection d'une journée
 * entière possible en un geste. L'en-tête de chaque jour sert de case à
 * cocher pour tout le groupe.
 */
function groupByDay(files: FileRow[], locale: string) {
  const map = new Map<string, FileRow[]>()
  for (const f of files) {
    const d = new Date(f.taken_at ?? f.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  const today = new Date().toDateString()
  return [...map].map(([key, fs]) => {
    const [y, m, day] = key.split('-')
    const date = new Date(Number(y), Number(m) - 1, Number(day))
    const isToday = date.toDateString() === today
    return {
      key,
      label: isToday
        ? date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
        : date.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
          }),
      files: fs,
    }
  })
}

export default function FilesBrowser({
  scope,
  mode = 'media',
}: {
  scope: Scope
  mode?: BrowserMode
}) {
  const nav = useNavigate()
  const { other } = useAuth()
  const { t, lang } = useI18n()
  const { show: toast } = useToast()
  const locale = lang === 'de' ? 'de-AT' : 'fr-FR'

  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: '' }])
  const [kind, setKind] = useState<KindFilter>('all')
  const [asc, setAsc] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<FileRow | null>(null)
  const [editing, setEditing] = useState<FileRow | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sending, setSending] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const folderId = crumbs[crumbs.length - 1].id
  const isDocs = mode === 'documents'

  // La galerie ne montre QUE photos et vidéos, les documents ont leur section.
  const kinds: FileKind[] = useMemo(
    () => (isDocs ? ['other'] : kind === 'all' ? ['photo', 'video'] : [kind as FileKind]),
    [isDocs, kind],
  )

  /**
   * Sans try/finally, une simple coupure réseau laissait `loading` à true
   * pour toujours: l'utilisateur restait devant un rond qui tourne, sans
   * message ni moyen de réessayer. Constaté en production, une requête vers
   * Supabase peut échouer en 503 sans prévenir.
   */
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [fl, fi] = await Promise.all([
        listFolders(scope, folderId),
        listFiles({ scope, folderId, kinds, asc }),
      ])
      setFolders(fl)
      setFiles(fi)
      if (!isDocs) setViewerList(fi)

      // Les miniatures sont un confort: leur échec ne doit pas empêcher la
      // galerie de s'afficher, on retombe sur les vignettes de repli.
      const keys = fi.map((f) => f.thumb_key).filter(Boolean) as string[]
      if (keys.length) signBatch(keys).then(setThumbs).catch(() => setThumbs({}))
      else setThumbs({})
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [scope, folderId, kinds, asc, isDocs])

  useEffect(() => {
    load()
  }, [load])

  // Une sélection n'a plus de sens après un changement de dossier ou de tri.
  useEffect(() => {
    setSelection(new Set())
  }, [folderId, scope, mode, kind, asc])

  const groups = useMemo(() => groupByDay(files, locale), [files, locale])

  const allSelected = files.length > 0 && selection.size === files.length

  const toggleAll = () =>
    setSelection(allSelected ? new Set() : new Set(files.map((f) => f.id)))

  // Cocher/décocher une journée entière depuis son en-tête.
  const toggleDay = (dayFiles: FileRow[]) =>
    setSelection((prev) => {
      const next = new Set(prev)
      const allIn = dayFiles.every((f) => next.has(f.id))
      for (const f of dayFiles) {
        if (allIn) next.delete(f.id)
        else next.add(f.id)
      }
      return next
    })

  // Suppression d'une sélection: vers la corbeille, jamais directement
  // détruite. La destruction définitive reste un geste séparé, depuis la
  // corbeille, et elle est irréversible.
  const trashSelection = async () => {
    const ids = [...selection]
    setSending(true)
    try {
      for (const id of ids) await trashFile(id)
      toast(`${ids.length} · ${t('select.trashed')}`, 'success')
      setSelection(new Set())
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSending(false)
    }
  }

  const openFolder = (f: Folder) => setCrumbs([...crumbs, { id: f.id, name: f.name }])
  const goCrumb = (i: number) => setCrumbs(crumbs.slice(0, i + 1))

  // Un document n'a rien à faire dans la visionneuse: on le télécharge.
  const openFile = (f: FileRow) => {
    if (isDocs) {
      downloadOriginal(f.r2_key, f.name)
      return
    }
    setViewerList(files)
    nav(`/view/${scope}/${f.id}`)
  }

  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onNewFolder = async (name: string) => {
    setNewFolder(false)
    try {
      await createFolder(name, scope, folderId)
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  // --- Actions sur un fichier ---
  const act = {
    download: (f: FileRow) => downloadOriginal(f.r2_key, f.name),
    edit: (f: FileRow) => setEditing(f),
    toShared: async (f: FileRow) => {
      await copyFile(f.id, 'shared', null)
    },
    recover: async (f: FileRow) => {
      await copyFile(f.id, 'personal', null)
    },
    send: async (f: FileRow) => {
      if (other) await createTransfer(f.id, other.id)
    },
    remove: async (f: FileRow) => {
      await trashFile(f.id)
      load()
    },
  }

  // --- Actions sur la sélection ---
  const sendSelection = async () => {
    if (!other) return
    setSending(true)
    try {
      for (const id of selection) await createTransfer(id, other.id)
      toast(`${selection.size} · ${t('select.sent')}`, 'success')
      setSelection(new Set())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSending(false)
    }
  }

  // Vers le Commun: soit la ligne y va (déplacer), soit une seconde
  // référence y est créée et l'original reste (copier). Aucun octet ne bouge
  // dans les deux cas, c'est le même objet R2.
  const toShared = async (mode: 'move' | 'copy') => {
    const ids = [...selection]
    setSharing(false)
    setSending(true)
    try {
      if (mode === 'move') {
        await moveToShared(ids)
      } else {
        for (const id of ids) await copyFile(id, 'shared', null)
      }
      toast(
        `${ids.length} · ${t(mode === 'move' ? 'shared.moved' : 'shared.copied')}`,
        'success',
      )
      setSelection(new Set())
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSending(false)
    }
  }

  const title = isDocs
    ? scope === 'shared'
      ? t('docs.shared')
      : t('docs.title')
    : scope === 'shared'
      ? t('shared.title')
      : t('gallery.mine')

  return (
    <div className="safe-top mx-auto max-w-3xl p-4">
      {/* Fil d'Ariane. Un vrai bouton retour apparaît dès qu'on est dans un
          dossier: les chevrons du fil ne se lisent pas comme un retour, et
          sur téléphone il n'y a pas de bouton précédent du navigateur. */}
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        {crumbs.length > 1 && (
          <button
            onClick={() => goCrumb(crumbs.length - 2)}
            aria-label={t('action.back')}
            title={t('action.back')}
            className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] transition active:scale-95"
          >
            <IconChevron size={16} />
          </button>
        )}
        <h1 className="font-semibold">{title}</h1>
        {crumbs.slice(1).map((c, i) => (
          <span key={c.id} className="flex items-center gap-1 text-[var(--color-muted)]">
            <IconChevron className="rotate-180" size={14} />
            <button className="max-w-[9rem] truncate" onClick={() => goCrumb(i + 1)}>
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Le Commun gère ses deux onglets lui-même (absent du burger). */}
      {scope === 'shared' && (
        <div className="mb-3 inline-flex rounded-xl bg-[var(--color-surface)] p-1 text-xs">
          {[
            { to: '/shared', label: t('shared.media') },
            { to: '/shared/docs', label: t('nav.docs') },
          ].map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 transition ${
                  isActive
                    ? 'glass-accent'
                    : 'text-[var(--color-muted)]'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      )}

      {/* Filtres, tri, nouveau dossier */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!isDocs && (
            <div className="inline-flex shrink-0 rounded-full bg-[var(--color-surface)] p-1 text-xs">
              {(['all', 'photo', 'video'] as KindFilter[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 ${
                    kind === k
                      ? 'glass-accent'
                      : 'text-[var(--color-muted)]'
                  }`}
                >
                  {k === 'all'
                    ? t('gallery.all')
                    : k === 'photo'
                      ? t('gallery.photos')
                      : t('gallery.videos')}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setAsc((v) => !v)}
            className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
          >
            {asc ? t('sort.oldest') : t('sort.newest')}
          </button>
          {files.length > 0 && (
            <button
              onClick={toggleAll}
              className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
            >
              {allSelected ? t('select.none') : t('select.all')}
            </button>
          )}
        </div>
        <button
          onClick={() => setNewFolder(true)}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
        >
          <IconFolder size={14} /> {t('action.newFolder')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--color-muted)]">
          <Spinner />
        </div>
      ) : loadError ? (
        <div className="glass glass-menu mx-auto mt-6 max-w-sm rounded-2xl p-4 text-center">
          <p className="mb-1 text-sm font-semibold">{t('common.loadFailed')}</p>
          <p className="mb-3 break-words text-xs text-[var(--color-muted)]">
            {loadError}
          </p>
          <Button onClick={load} className="w-full">
            {t('upload.retry')}
          </Button>
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <EmptyState>
          {isDocs
            ? t('docs.empty')
            : scope === 'shared'
              ? t('shared.empty')
              : t('gallery.empty')}
        </EmptyState>
      ) : (
        <>
          {/* Dossiers */}
          {folders.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openFolder(f)}
                  className="glass-soft flex items-center gap-2 rounded-xl p-3 text-left text-sm"
                >
                  <IconFolder size={20} className="text-[var(--color-accent)]" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Fichiers groupés par mois */}
          {groups.map((g) => (
            <section key={g.key} className="mb-5">
              {/* L'en-tête du jour est cliquable: un geste pour toute la
                  journée, ce qui évite de cocher trente photos une à une. */}
              <button
                onClick={() => toggleDay(g.files)}
                className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] transition hover:text-[var(--color-text)]"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border-2 transition ${
                    g.files.every((f) => selection.has(f.id))
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                      : 'border-[var(--color-border)] text-transparent'
                  }`}
                >
                  <IconCheck size={10} />
                </span>
                {g.label}
                <span className="font-normal normal-case opacity-70">
                  ({g.files.length})
                </span>
              </button>

              {isDocs ? (
                <div className="flex flex-col gap-1.5">
                  {g.files.map((f) => (
                    <DocRow
                      key={f.id}
                      file={f}
                      locale={locale}
                      selected={selection.has(f.id)}
                      onToggle={() => toggle(f.id)}
                      onOpen={() => openFile(f)}
                      onMore={() => setSheet(f)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                  {g.files.map((f) => (
                    <div key={f.id} className="relative">
                      <FileTile
                        file={f}
                        thumbUrl={f.thumb_key ? thumbs[f.thumb_key] : undefined}
                        onClick={() => openFile(f)}
                      />
                      <SelectDot
                        selected={selection.has(f.id)}
                        onClick={() => toggle(f.id)}
                      />
                      <button
                        onClick={() => setSheet(f)}
                        className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white"
                        aria-label="actions"
                      >
                        ⋯
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}

      {/* Barre d'actions: apparaît dès qu'un fichier est sélectionné */}
      {selection.size > 0 && (
        <div className="sticky bottom-2 z-30 mt-4">
          {/* Cinq actions ne tiennent pas sur une ligne de téléphone: la barre
              passe donc à la ligne au lieu de déborder, le compteur a sa
              propre ligne, et chaque libellé est insécable pour qu'aucun
              bouton ne se coupe en deux. */}
          <div className="glass glass-menu mx-auto max-w-md rounded-2xl p-2">
            <div className="mb-1.5 px-1 text-[11px] text-[var(--color-muted)]">
              {selection.size} {t('select.count')}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {other && (
                <button
                  onClick={sendSelection}
                  disabled={sending}
                  className="glass-accent flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  title={`${t('action.send')} ${other.display_name}`}
                >
                  {sending ? <Spinner className="h-3.5 w-3.5" /> : <IconSend size={14} />}
                  {other.display_name}
                </button>
              )}
              {/* Le Commun: déplacer (la ligne quitte le perso) ou copier
                  (l'original reste). Deux intentions différentes, on laisse
                  le choix au lieu d'en imposer une. */}
              {scope === 'personal' && (
                <button
                  onClick={() => setSharing(true)}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
                >
                  <IconShared size={14} /> {t('shared.title')}
                </button>
              )}
              <button
                onClick={() => setMoving(true)}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
              >
                <IconMove size={14} /> {t('action.move')}
              </button>
              <button
                onClick={trashSelection}
                disabled={sending}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-danger)] disabled:opacity-50"
              >
                <IconTrash size={14} /> {t('action.delete')}
              </button>
              <button
                onClick={() => setSelection(new Set())}
                aria-label={t('select.none')}
                className="shrink-0 rounded-full px-2.5 py-1.5 text-xs text-[var(--color-muted)]"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feuille d'actions */}
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.name}>
        {sheet && (
          <>
            <SheetButton onClick={() => run(act.download, sheet, setSheet)}>
              ⬇ {t('action.download')}
            </SheetButton>
            {other && (
              <SheetButton onClick={() => run(act.send, sheet, setSheet)}>
                ➤ {t('action.send')} {other.display_name}
              </SheetButton>
            )}
            {scope === 'personal' ? (
              <SheetButton onClick={() => run(act.toShared, sheet, setSheet)}>
                ☁ {t('action.moveToShared')}
              </SheetButton>
            ) : (
              <SheetButton onClick={() => run(act.recover, sheet, setSheet)}>
                ↙ {t('action.recover')}
              </SheetButton>
            )}
            <SheetButton onClick={() => run(act.edit, sheet, setSheet)}>
              ✎ {t('action.edit')}
            </SheetButton>
            <SheetButton danger onClick={() => run(act.remove, sheet, setSheet)}>
              🗑 {t('action.delete')}
            </SheetButton>
          </>
        )}
      </BottomSheet>

      {editing && (
        <FileEditDialog
          file={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {/* Choix déplacer / copier vers le Commun */}
      <BottomSheet
        open={sharing}
        onClose={() => setSharing(false)}
        title={`${selection.size} ${t('select.count')}`}
      >
        <SheetButton onClick={() => toShared('move')}>
          ☁ {t('shared.moveHere')}
        </SheetButton>
        <SheetButton onClick={() => toShared('copy')}>
          ⧉ {t('shared.copyHere')}
        </SheetButton>
        <p className="px-4 pb-2 pt-1 text-xs text-[var(--color-muted)]">
          {t('shared.moveCopyHint')}
        </p>
      </BottomSheet>

      {newFolder && (
        <TextPromptDialog
          title={t('action.newFolder')}
          placeholder={t('folder.name')}
          confirmLabel={t('action.create')}
          onCancel={() => setNewFolder(false)}
          onConfirm={onNewFolder}
        />
      )}

      {moving && (
        <MoveDialog
          ids={[...selection]}
          scope={scope}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setSelection(new Set())
            load()
          }}
        />
      )}
    </div>
  )
}

// Pastille de sélection sur une tuile de galerie.
function SelectDot({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="select"
      className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${
        selected
          ? 'glass-accent border-transparent'
          : 'border-white/80 bg-black/30 text-transparent'
      }`}
    >
      <IconCheck size={12} />
    </button>
  )
}

// Ligne de document: chaque fichier porte sa propre date.
function DocRow({
  file,
  locale,
  selected,
  onToggle,
  onOpen,
  onMore,
}: {
  file: FileRow
  locale: string
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onMore: () => void
}) {
  const d = new Date(file.taken_at ?? file.created_at)
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase()
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20'
          : 'border-transparent bg-[var(--color-surface)]'
      }`}
    >
      <button
        onClick={onToggle}
        aria-label="select"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected
            ? 'glass-accent border-transparent'
            : 'border-[var(--color-border)] text-transparent'
        }`}
      >
        <IconCheck size={12} />
      </button>

      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative shrink-0 text-[var(--color-muted)]">
          <IconDoc size={26} />
          <span className="absolute inset-x-0 bottom-1 text-center text-[7px] font-bold">
            {ext.slice(0, 4)}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{file.name}</span>
          <span className="block text-xs text-[var(--color-muted)]">
            {d.toLocaleDateString(locale, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
            {' · '}
            {formatBytes(file.size_bytes)}
          </span>
        </span>
      </button>

      <button
        onClick={onMore}
        aria-label="actions"
        className="shrink-0 px-2 text-[var(--color-muted)]"
      >
        ⋯
      </button>
    </div>
  )
}

// Exécute une action puis ferme la feuille.
function run(
  fn: (f: FileRow) => void | Promise<void>,
  file: FileRow,
  close: (v: null) => void,
) {
  Promise.resolve(fn(file)).finally(() => close(null))
}
