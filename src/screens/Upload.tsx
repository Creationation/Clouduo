import { useEffect, useRef, useState } from 'react'
import { useQueue } from '../lib/queue'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../lib/auth'
import { filesFromDataTransfer, filesFromInput } from '../lib/dropFiles'
import type { Scope } from '../lib/types'
import QueueList from '../components/QueueList'
import { formatBytes } from '../components/ui'
import { checkQuota } from '../lib/quota'
import { useToast } from '../lib/toast'

// personal / shared = où le fichier atterrit. send = il reste chez moi et
// part en attente chez l'autre (transfert), sans passer par le Commun.
type Dest = 'personal' | 'shared' | 'send'

export default function Upload() {
  const { add } = useQueue()
  const { t } = useI18n()
  const { other } = useAuth()
  const { show: toast } = useToast()
  const [dest, setDest] = useState<Dest>('personal')
  const [note, setNote] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [scanning, setScanning] = useState(0)
  const [lastAdded, setLastAdded] = useState<{ n: number; bytes: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  // webkitdirectory n'existe pas dans les types JSX: on le pose sur le DOM.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const push = async (files: File[]) => {
    if (!files.length) {
      setLastAdded({ n: 0, bytes: 0 })
      return
    }

    // Contrôle du plafond AVANT de mettre en file: prévenir une fois au
    // départ vaut mieux que découvrir le problème après des heures d'envoi.
    const incoming = files.reduce((s, f) => s + f.size, 0)
    try {
      const q = await checkQuota(incoming)
      if (q.full) {
        toast(
          `${t('quota.full')} ${formatBytes(q.used)} / ${formatBytes(q.quota)}`,
          'error',
          9000,
        )
        return
      }
      if (q.near) {
        toast(
          `${t('quota.near')} ${formatBytes(q.used + incoming)} / ${formatBytes(q.quota)}`,
          'warning',
          8000,
        )
      }
    } catch {
      /* stats indisponibles: on n'empêche pas d'envoyer pour autant */
    }

    const scope: Scope = dest === 'shared' ? 'shared' : 'personal'
    await add(files, {
      scope,
      sendToUserId: dest === 'send' ? other?.id : undefined,
      note: dest === 'send' && note.trim() ? note.trim() : undefined,
    })
    setLastAdded({ n: files.length, bytes: files.reduce((s, f) => s + f.size, 0) })
    setNote('')
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    setScanning(1)
    try {
      const files = await filesFromDataTransfer(e.dataTransfer, setScanning)
      await push(files)
    } finally {
      setScanning(0)
    }
  }

  const destButtons: { key: Dest; label: string }[] = [
    { key: 'personal', label: t('gallery.mine') },
    { key: 'shared', label: t('shared.title') },
  ]
  if (other) destButtons.push({ key: 'send', label: `${t('action.send')} ${other.display_name}` })

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-3 text-xl font-semibold">{t('upload.title')}</h1>

      {/* Destination: perso, Commun, ou envoi direct à l'autre */}
      <div className="mb-1 text-xs text-[var(--color-muted)]">{t('upload.dest')}</div>
      <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-[var(--color-surface)] p-1">
        {destButtons.map((d) => (
          <button
            key={d.key}
            onClick={() => setDest(d.key)}
            className={`rounded-lg px-4 py-2 text-sm ${
              dest === d.key
                ? 'glass-accent'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {dest === 'send' && other && (
        <div className="mb-4">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('upload.note')}
            className="w-full rounded-xl bg-[var(--color-surface)] px-4 py-2.5 text-sm outline-none"
          />
          <p className="mt-1.5 text-xs text-[var(--color-muted)]">
            {t('upload.sendHint')} {other.display_name}
          </p>
        </div>
      )}

      {/* Zone drop (PC): fichiers ET dossiers */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/30'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
        }`}
      >
        <div className="mb-2 text-3xl">☁️</div>
        {scanning ? (
          <p className="text-sm text-[var(--color-muted)]">
            {t('upload.scanning')} {scanning > 1 ? scanning : ''}
          </p>
        ) : (
          <>
            <p className="text-sm">{t('upload.drop')}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{t('upload.dropHint')}</p>
          </>
        )}
      </div>

      {lastAdded && !scanning && (
        <p className="mt-2 text-center text-sm text-[var(--color-muted)]">
          {lastAdded.n === 0
            ? t('upload.none')
            : `${lastAdded.n} ${t('upload.added')} · ${formatBytes(lastAdded.bytes)}`}
        </p>
      )}

      {/* Sélection manuelle: fichiers, dossier (PC), caméra (mobile) */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-xl bg-[var(--color-surface-2)] py-3 text-sm"
        >
          {t('upload.mobile')}
        </button>
        <button
          onClick={() => folderInput.current?.click()}
          className="rounded-xl bg-[var(--color-surface-2)] py-3 text-sm"
        >
          {t('upload.folder')}
        </button>
        <button
          onClick={() => cameraInput.current?.click()}
          className="rounded-xl bg-[var(--color-surface-2)] py-3 text-sm"
        >
          {t('upload.camera')}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void push(filesFromInput(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void push(filesFromInput(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void push(filesFromInput(e.target.files))
          e.target.value = ''
        }}
      />

      <QueueList />
    </div>
  )
}
