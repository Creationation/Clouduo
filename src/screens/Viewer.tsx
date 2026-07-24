import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FileRow } from '../lib/types'
import { getFile } from '../lib/files'
import { getViewerList } from '../lib/viewerStore'
import { signOne, downloadOriginal } from '../lib/urls'
import { IconClose, IconDownload, IconChevron } from '../components/icons'
import { Spinner } from '../components/ui'

// Visionneuse plein écran: photo (double-tap zoom, swipe) + vidéo (streaming).
export default function Viewer() {
  const nav = useNavigate()
  const { id } = useParams()
  const [list, setList] = useState<FileRow[]>([])
  const [index, setIndex] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const touchX = useRef<number | null>(null)

  // Constituer la liste (contexte galerie) ou retomber sur un fetch unitaire.
  useEffect(() => {
    const cached = getViewerList()
    const found = cached.findIndex((f) => f.id === id)
    if (found >= 0) {
      setList(cached)
      setIndex(found)
    } else if (id) {
      getFile(id).then((f) => {
        if (f) {
          setList([f])
          setIndex(0)
        }
      })
    }
  }, [id])

  const file = list[index]

  // Signer l'original à chaque changement d'image.
  useEffect(() => {
    if (!file) return
    setUrl(null)
    setZoom(false)
    signOne(file.r2_key).then(setUrl)
  }, [file])

  const go = useCallback(
    (dir: number) => {
      setIndex((i) => Math.min(list.length - 1, Math.max(0, i + dir)))
    },
    [list.length],
  )

  // Clavier (desktop): flèches + Échap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'Escape') nav(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, nav])

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-white">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Barre haut */}
      <div className="safe-top flex items-center justify-between p-3 text-white">
        <button onClick={() => nav(-1)} className="rounded-full bg-white/10 p-2">
          <IconClose size={20} />
        </button>
        <span className="truncate px-2 text-sm">{file.name}</span>
        <button
          onClick={() => downloadOriginal(file.r2_key, file.name)}
          className="rounded-full bg-white/10 p-2"
        >
          <IconDownload size={20} />
        </button>
      </div>

      {/* Média */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current == null || zoom) return
          const dx = e.changedTouches[0].clientX - touchX.current
          if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1)
          touchX.current = null
        }}
      >
        {!url ? (
          <Spinner className="text-white" />
        ) : file.kind === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            src={url}
            alt={file.name}
            onDoubleClick={() => setZoom((z) => !z)}
            className={`max-h-full max-w-full select-none transition-transform ${
              zoom ? 'scale-[2.2] cursor-zoom-out' : 'cursor-zoom-in'
            }`}
            draggable={false}
          />
        )}

        {/* Navigation desktop */}
        {index > 0 && (
          <button
            onClick={() => go(-1)}
            className="absolute left-2 hidden rounded-full bg-white/10 p-2 text-white sm:block"
          >
            <IconChevron size={24} />
          </button>
        )}
        {index < list.length - 1 && (
          <button
            onClick={() => go(1)}
            className="absolute right-2 hidden rotate-180 rounded-full bg-white/10 p-2 text-white sm:block"
          >
            <IconChevron size={24} />
          </button>
        )}
      </div>

      {/* Compteur */}
      {list.length > 1 && (
        <div className="safe-bottom pb-2 text-center text-xs text-white/60">
          {index + 1} / {list.length}
        </div>
      )}
    </div>
  )
}
