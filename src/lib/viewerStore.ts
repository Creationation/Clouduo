import type { FileRow } from './types'

// Liste ordonnée courante, partagée avec la visionneuse pour le swipe.
// (Deep-link direct: la visionneuse retombe sur un fetch unitaire.)
let current: FileRow[] = []

export function setViewerList(files: FileRow[]) {
  current = files
}
export function getViewerList(): FileRow[] {
  return current
}
