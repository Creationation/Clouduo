import { useEffect, useState } from 'react'
import type { Scope } from '../lib/types'
import { listFolderTree, moveFiles, createFolder, type FolderNode } from '../lib/files'
import { useI18n } from '../lib/i18n'
import { Button, Spinner } from './ui'
import { IconFolder } from './icons'
import TextPromptDialog from './TextPromptDialog'
import { useBackdropDismiss } from './overlay'
import Portal from './Portal'

/**
 * Choix du dossier de destination pour un lot de fichiers.
 * Le déplacement ne touche que la ligne en base: aucun objet R2 n'est
 * recopié ni réécrit.
 */
export default function MoveDialog({
  ids,
  scope,
  onClose,
  onMoved,
}: {
  ids: string[]
  scope: Scope
  onClose: () => void
  onMoved: (count: number) => void
}) {
  const { t } = useI18n()
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prompting, setPrompting] = useState(false)
  const backdrop = useBackdropDismiss(onClose)

  const load = () => {
    setLoading(true)
    listFolderTree(scope)
      .then(setFolders)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [scope])

  const move = async (folderId: string | null) => {
    setBusy(true)
    setError('')
    try {
      await moveFiles(ids, folderId)
      onMoved(ids.length)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const addFolder = async (name: string) => {
    setPrompting(false)
    try {
      await createFolder(name, scope, null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...backdrop}
    >
      <div
        className="glass glass-menu flex max-h-[70vh] w-full max-w-sm flex-col rounded-3xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold">{t('move.title')}</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {ids.length} {t('select.count')}
        </p>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {loading ? (
            <div className="flex justify-center py-8 text-[var(--color-muted)]">
              <Spinner />
            </div>
          ) : (
            <>
              <button
                onClick={() => move(null)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                <IconFolder size={16} className="text-[var(--color-accent)]" />
                {t('move.root')}
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => move(f.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50"
                  style={{ paddingLeft: `${12 + f.depth * 16}px` }}
                >
                  <IconFolder size={16} className="text-[var(--color-accent)]" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => setPrompting(true)} disabled={busy}>
            {t('action.newFolder')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
        </div>
      </div>

      {prompting && (
        <TextPromptDialog
          title={t('action.newFolder')}
          placeholder={t('folder.name')}
          confirmLabel={t('action.create')}
          onCancel={() => setPrompting(false)}
          onConfirm={addFolder}
        />
      )}
    </div>
    </Portal>
  )
}
