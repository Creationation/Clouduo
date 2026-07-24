import type { FileRow } from '../lib/types'
import { IconPlay } from './icons'

function fmtDuration(s?: number | null) {
  if (!s) return null
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Tuile de galerie. Affiche la miniature signée; si absente (HEIC/HEVC non
// décodable au moment de l'upload), on montre un placeholder + type.
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
  return (
    <button
      onClick={onClick}
      className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--color-surface-2)]"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          loading="lazy"
          alt={file.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center">
          <span className="text-2xl">{file.kind === 'video' ? '🎬' : '🖼️'}</span>
          <span className="w-full truncate px-1 text-[9px] text-[var(--color-muted)]">
            {file.mime_type.split('/')[1]?.toUpperCase()}
          </span>
        </div>
      )}

      {file.kind === 'video' && (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/45 p-1.5 text-white">
              <IconPlay size={16} />
            </span>
          </span>
          {dur && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
              {dur}
            </span>
          )}
        </>
      )}
    </button>
  )
}
