import { useRef, useState } from 'react'
import { useQueue } from '../lib/queue'
import { useI18n } from '../lib/i18n'
import type { Scope } from '../lib/types'
import QueueList from '../components/QueueList'

export default function Upload() {
  const { add } = useQueue()
  const { t } = useI18n()
  const [scope, setScope] = useState<Scope>('personal')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  const onFiles = (files: FileList | null) => {
    if (files && files.length) add(files, { scope })
  }

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-3 text-xl font-semibold">{t('upload.title')}</h1>

      {/* Destination: perso ou directement dans le Commun */}
      <div className="mb-4 inline-flex rounded-xl bg-[var(--color-surface)] p-1">
        {(['personal', 'shared'] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-lg px-4 py-2 text-sm ${
              scope === s
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-muted)]'
            }`}
          >
            {s === 'personal' ? t('gallery.mine') : t('shared.title')}
          </button>
        ))}
      </div>

      {/* Zone drop (PC) */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInput.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/30'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
        }`}
      >
        <div className="mb-2 text-3xl">☁️</div>
        <p className="text-sm text-[var(--color-muted)]">{t('upload.drop')}</p>
      </div>

      {/* Boutons mobiles: galerie + caméra */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-xl bg-[var(--color-surface-2)] py-3 text-sm"
        >
          {t('upload.mobile')}
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
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          onFiles(e.target.files)
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
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <QueueList />
    </div>
  )
}
