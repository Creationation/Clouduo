// Un dossier déposé n'apparaît PAS dans dataTransfer.files: la liste ne
// contient que les fichiers de premier niveau. Pour déposer une photothèque
// entière sur PC il faut passer par l'API entries et descendre récursivement.

const MAX_FILES = 200_000

// Rebuts de l'explorateur Windows / macOS, jamais voulus dans le cloud.
const JUNK = new Set(['thumbs.db', 'desktop.ini', '.ds_store', 'icon\r'])

interface Entry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file(cb: (f: File) => void, err: (e: unknown) => void): void
  createReader(): {
    readEntries(cb: (entries: Entry[]) => void, err: (e: unknown) => void): void
  }
}

// Photos, vidéos ET documents sont acceptés: le classement par section se
// fait ensuite sur `kind`. On n'écarte que les fichiers cachés et les rebuts.
export function isAllowed(file: File): boolean {
  const n = file.name.toLowerCase()
  return !n.startsWith('.') && !JUNK.has(n)
}

// Ignore les dossiers système / caches qui n'ont rien à faire dans le cloud.
function skipDir(name: string): boolean {
  return name.startsWith('.') || name === '$RECYCLE.BIN' || name === 'System Volume Information'
}

async function walk(entry: Entry, out: File[], onCount?: (n: number) => void): Promise<void> {
  if (out.length >= MAX_FILES) return

  if (entry.isFile) {
    const file = await new Promise<File | null>((res) =>
      entry.file(
        (f) => res(f),
        () => res(null),
      ),
    )
    if (file && isAllowed(file)) {
      out.push(file)
      if (out.length % 200 === 0) onCount?.(out.length)
    }
    return
  }

  if (!entry.isDirectory || skipDir(entry.name)) return

  const reader = entry.createReader()
  // readEntries ne renvoie qu'un lot (100 en général) par appel: il faut
  // boucler jusqu'au lot vide, sinon un gros dossier est tronqué.
  for (;;) {
    const batch = await new Promise<Entry[]>((res) =>
      reader.readEntries(
        (e) => res(e),
        () => res([]),
      ),
    )
    if (!batch.length) break
    for (const child of batch) await walk(child, out, onCount)
  }
}

/**
 * Fichiers média d'un dépôt, dossiers inclus (récursif).
 * onCount permet d'afficher l'avancement du scan sur les gros dossiers.
 */
export async function filesFromDataTransfer(
  dt: DataTransfer,
  onCount?: (n: number) => void,
): Promise<File[]> {
  const entries: Entry[] = []
  for (const item of Array.from(dt.items ?? [])) {
    const getEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => Entry | null
    }).webkitGetAsEntry
    const entry = getEntry?.call(item) ?? null
    if (entry) entries.push(entry)
  }

  // Navigateur sans l'API entries: on retombe sur les fichiers à plat.
  if (!entries.length) return Array.from(dt.files).filter(isAllowed)

  const out: File[] = []
  for (const entry of entries) await walk(entry, out, onCount)
  return out
}

// Sélection via <input>: webkitdirectory renvoie tout le contenu du dossier,
// fichiers cachés et rebuts système compris, qu'on écarte ici.
export function filesFromInput(list: FileList | null): File[] {
  return list ? Array.from(list).filter(isAllowed) : []
}
