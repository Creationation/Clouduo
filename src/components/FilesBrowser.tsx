import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FileRow, Folder, Scope } from '../lib/types'
import {
  listFiles,
  listFolders,
  createFolder,
  renameFile,
  trashFile,
  copyFile,
  type KindFilter,
} from '../lib/files'
import { signBatch, downloadOriginal } from '../lib/urls'
import { createTransfer } from '../lib/transfers'
import { setViewerList } from '../lib/viewerStore'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import FileTile from './FileTile'
import BottomSheet, { SheetButton } from './BottomSheet'
import { IconFolder, IconChevron } from './icons'
import { EmptyState, Spinner } from './ui'

interface Crumb {
  id: string | null
  name: string
}

// Regroupe les fichiers par mois (taken_at) pour l'affichage type galerie photo.
function groupByMonth(files: FileRow[]) {
  const groups: { key: string; label: string; files: FileRow[] }[] = []
  const map = new Map<string, FileRow[]>()
  for (const f of files) {
    const d = f.taken_at ? new Date(f.taken_at) : new Date(f.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  for (const [key, fs] of map) {
    const [y, m] = key.split('-')
    const label = new Date(Number(y), Number(m) - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })
    groups.push({ key, label, files: fs })
  }
  return groups
}

export default function FilesBrowser({ scope }: { scope: Scope }) {
  const nav = useNavigate()
  const { other } = useAuth()
  const { t } = useI18n()
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: '' }])
  const [kind, setKind] = useState<KindFilter>('all')
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<FileRow | null>(null)

  const folderId = crumbs[crumbs.length - 1].id

  const load = useCallback(async () => {
    setLoading(true)
    const [fl, fi] = await Promise.all([
      listFolders(scope, folderId),
      listFiles({ scope, folderId, kind }),
    ])
    setFolders(fl)
    setFiles(fi)
    setViewerList(fi)
    setLoading(false)
    // Signer les miniatures en un lot.
    const keys = fi.map((f) => f.thumb_key).filter(Boolean) as string[]
    if (keys.length) signBatch(keys).then(setThumbs)
    else setThumbs({})
  }, [scope, folderId, kind])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => groupByMonth(files), [files])

  const openFolder = (f: Folder) => setCrumbs([...crumbs, { id: f.id, name: f.name }])
  const goCrumb = (i: number) => setCrumbs(crumbs.slice(0, i + 1))

  const openFile = (f: FileRow) => {
    setViewerList(files)
    nav(`/view/${scope}/${f.id}`)
  }

  const onNewFolder = async () => {
    const name = window.prompt(t('action.newFolder'))
    if (name?.trim()) {
      await createFolder(name.trim(), scope, folderId)
      load()
    }
  }

  // --- Actions sur un fichier ---
  const act = {
    download: (f: FileRow) => downloadOriginal(f.r2_key, f.name),
    rename: async (f: FileRow) => {
      const name = window.prompt(t('action.rename'), f.name)
      if (name?.trim()) {
        await renameFile(f.id, name.trim())
        load()
      }
    },
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

  return (
    <div className="safe-top mx-auto max-w-3xl p-4">
      {/* Fil d'Ariane */}
      <div className="mb-2 flex items-center gap-1 text-sm">
        <h1 className="font-semibold">
          {scope === 'shared' ? t('shared.title') : t('gallery.mine')}
        </h1>
        {crumbs.slice(1).map((c, i) => (
          <span key={c.id} className="flex items-center gap-1 text-[var(--color-muted)]">
            <IconChevron className="rotate-180" size={14} />
            <button onClick={() => goCrumb(i + 1)}>{c.name}</button>
          </span>
        ))}
      </div>

      {/* Filtres + nouveau dossier */}
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-[var(--color-surface)] p-1 text-xs">
          {(['all', 'photo', 'video'] as KindFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1.5 ${
                kind === k ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)]'
              }`}
            >
              {k === 'all' ? t('gallery.all') : k === 'photo' ? t('gallery.photos') : t('gallery.videos')}
            </button>
          ))}
        </div>
        <button
          onClick={onNewFolder}
          className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-xs"
        >
          <IconFolder size={14} /> {t('action.newFolder')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--color-muted)]">
          <Spinner />
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <EmptyState>
          {scope === 'shared' ? t('shared.empty') : t('gallery.empty')}
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
                  className="flex items-center gap-2 rounded-xl bg-[var(--color-surface)] p-3 text-left text-sm"
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
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                {g.label}
              </h2>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                {g.files.map((f) => (
                  <div key={f.id} className="relative">
                    <FileTile
                      file={f}
                      thumbUrl={f.thumb_key ? thumbs[f.thumb_key] : undefined}
                      onClick={() => openFile(f)}
                    />
                    <button
                      onClick={() => setSheet(f)}
                      className="absolute right-1 top-1 rounded-full bg-black/50 px-1.5 text-white"
                      aria-label="actions"
                    >
                      ⋯
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
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
            <SheetButton onClick={() => run(act.rename, sheet, setSheet)}>
              ✎ {t('action.rename')}
            </SheetButton>
            <SheetButton danger onClick={() => run(act.remove, sheet, setSheet)}>
              🗑 {t('action.delete')}
            </SheetButton>
          </>
        )}
      </BottomSheet>
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
