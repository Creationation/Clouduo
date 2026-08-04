import { useEffect, useState } from 'react'
import type { FileRow } from '../lib/types'
import { IconPlay, IconGallery, IconDoc } from './icons'
import { signOne } from '../lib/urls'

function fmtDuration(s?: number | null) {
  if (!s) return null
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * Tuile de galerie.
 *
 * `w-full` n'est pas décoratif: un bouton se dimensionne sur son contenu. Sans
 * lui, dès que la miniature manquait, la tuile retombait à la taille de son
 * icône de repli, une vignette de 90 px perdue dans une case de 300 px, avec
 * le bouton d'actions à l'autre bout. C'est ce qui donnait cet air de
 * gestionnaire de fichiers des années 90 au lieu d'une galerie.
 *
 * Si la miniature ne se charge pas (URL signée périmée, réseau coupé au
 * mauvais moment), on ne laisse pas l'icône cassée du navigateur: on redemande
 * une URL fraîche une fois, puis on se rabat sur l'original pour les photos.
 * Une galerie sans aperçu n'est plus une galerie.
 */
export default function FileTile({
  file,
  thumbUrl,
  onClick,
}: {
  file: FileRow
  thumbUrl?: string
  onClick: () => void
}) {
  const dur = fmtDuration(file.duration_seconds)
  const [src, setSrc] = useState(thumbUrl)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    setSrc(thumbUrl)
    setTries(0)
  }, [thumbUrl])

  const onError = async () => {
    if (tries >= 2) {
      setSrc(undefined)
      return
    }
    setTries((n) => n + 1)
    try {
      // 1er essai: une URL signée toute neuve pour la miniature.
      // 2e essai: l'original lui-même, plus lourd mais toujours présent.
      const key = tries === 0 ? file.thumb_key : file.kind === 'photo' ? file.r2_key : null
      if (!key) {
        setSrc(undefined)
        return
      }
      setSrc(await signOne(key, { fresh: true }))
    } catch {
      setSrc(undefined)
    }
  }

  return (
    <button
      onClick={onClick}
      className="group relative aspect-square w-full overflow-hidden rounded-xl bg-[var(--color-surface-2)]"
    >
      {src ? (
        <img
          src={src}
          loading="lazy"
          decoding="async"
          alt={file.name}
          onError={onError}
          className="h-full w-full object-cover"
        />
      ) : (
        // Repli sobre: un dégradé et un pictogramme, jamais d'émoji ni
        // d'icône cassée. La tuile garde exactement la même surface.
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/25 to-white/5 text-[var(--color-muted)]">
          {file.kind === 'other' ? (
            <IconDoc size={22} />
          ) : (
            <IconGallery size={22} />
          )}
        </span>
      )}

      {file.kind === 'video' && (
        <>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/35 p-1.5 text-white backdrop-blur-sm">
              <IconPlay size={14} />
            </span>
          </span>
          {dur && (
            <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 px-1.5 text-[10px] font-medium text-white">
              {dur}
            </span>
          )}
        </>
      )}
    </button>
  )
}
