import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { trashFile } from '../lib/files'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Button, EmptyState, Spinner, formatBytes } from '../components/ui'

interface Group {
  content_hash: string
  scope: 'personal' | 'shared'
  copies: number
  distinct_objects: number
  size_bytes: number
  wasted_bytes: number
  sample_name: string
  kind: string
  ids: string[]
}

/**
 * Doublons déjà présents dans le cloud.
 *
 * La dédup à l'upload empêche de renvoyer un fichier connu, mais ne nettoie
 * pas l'existant. Le regroupement se fait sur l'empreinte sha-256: deux
 * fichiers renommés, ou arrivés par des chemins différents, sont détectés
 * comme identiques quel que soit leur type: photo, vidéo ou document.
 */
export default function Duplicates() {
  const { t, lang } = useI18n()
  const { show: toast } = useToast()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState<{ done: number; total: number } | null>(
    null,
  )

  // Le hash ne suffit plus a identifier un groupe: le meme contenu peut
  // exister a la fois chez moi et dans le Commun, et ce sont deux groupes.
  const keyOf = (g: Group) => `${g.scope}:${g.content_hash}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('find_duplicate_groups')
      if (error) throw error
      setGroups((data as Group[]) ?? [])
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // On garde le plus ancien (ids est trié par created_at) et on envoie les
  // autres à la corbeille: rien n'est détruit, la purge a 30 jours pour
  // laisser le temps de revenir en arrière.
  const cleanGroup = async (g: Group) => {
    setBusy(keyOf(g))
    try {
      for (const id of g.ids.slice(1)) await trashFile(id)
      toast(`${g.copies - 1} ${t('dup.movedToTrash')}`, 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Tout d'un coup: la correction du 2026-08-24 empeche les nouveaux
  // doublons, elle ne range pas ceux deja recus. Les traiter un par un sur un
  // telephone n'est pas serieux quand il y en a cinquante.
  const cleanAll = async () => {
    const jobs = groups.flatMap((g) => g.ids.slice(1))
    if (!jobs.length) return
    setCleaning({ done: 0, total: jobs.length })
    let ok = 0
    for (const id of jobs) {
      // Un echec isole (fichier deja retire entre temps) ne doit pas arreter
      // le rangement: on continue et on annonce le compte reel a la fin.
      try {
        await trashFile(id)
        ok += 1
      } catch {
        /* on passe au suivant */
      }
      setCleaning((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    setCleaning(null)
    toast(`${ok} ${t('dup.movedToTrash')}`, 'success')
    await load()
  }

  const totalWasted = groups.reduce((s, g) => s + Number(g.wasted_bytes || 0), 0)
  const locale = lang === 'de' ? 'de-AT' : 'fr-FR'

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-1 text-xl font-semibold">{t('dup.title')}</h1>
      <p className="mb-5 text-sm text-[var(--color-muted)]">{t('dup.intro')}</p>

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--color-muted)]">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState>{t('dup.none')}</EmptyState>
      ) : (
        <>
          <div className="glass mb-4 rounded-2xl p-4 text-sm">
            <div className="flex items-center justify-between">
              <span>{t('dup.groups')}</span>
              <span className="text-[var(--color-muted)]">{groups.length}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>{t('dup.recoverable')}</span>
              <span className="font-semibold text-[var(--color-success)]">
                {formatBytes(totalWasted)}
              </span>
            </div>
            <Button
              onClick={cleanAll}
              disabled={!!cleaning}
              className="mt-3 w-full py-2 text-sm"
            >
              {cleaning
                ? `${cleaning.done}/${cleaning.total}`
                : t('dup.cleanAll')}
            </Button>
            <p className="mt-1.5 text-center text-xs text-[var(--color-muted)]">
              {t('dup.cleanAllHint')}
            </p>
          </div>

          <ul className="space-y-2">
            {groups.map((g) => {
              // Plusieurs lignes sur le MÊME objet R2 ne coûtent rien de plus:
              // le dire évite de faire supprimer pour rien.
              const sameObject = g.distinct_objects === 1
              return (
                <li key={keyOf(g)} className="glass rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {g.kind === 'video' ? '🎬' : g.kind === 'photo' ? '🖼️' : '📄'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{g.sample_name}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {g.copies} {t('dup.copies')} ·{' '}
                        {g.scope === 'shared' ? t('dup.inShared') : t('dup.inMine')} ·{' '}
                        {formatBytes(Number(g.size_bytes))}
                        {sameObject
                          ? ` · ${t('dup.sameObject')}`
                          : ` · ${formatBytes(Number(g.wasted_bytes))} ${t('dup.wasted')}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => cleanGroup(g)}
                      disabled={busy === keyOf(g) || !!cleaning}
                      className="shrink-0 px-3 py-2 text-xs"
                    >
                      {busy === keyOf(g) ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        t('dup.keepOne')
                      )}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>

          <p className="mt-4 text-xs text-[var(--color-muted)]">
            {t('dup.note')} ({new Date().toLocaleDateString(locale)})
          </p>
        </>
      )}
    </div>
  )
}
