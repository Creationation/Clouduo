import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { trashFile } from '../lib/files'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Button, EmptyState, Spinner, formatBytes } from '../components/ui'

interface Group {
  content_hash: string
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
 * comme identiques quel que soit leur type — photo, vidéo ou document.
 */
export default function Duplicates() {
  const { t, lang } = useI18n()
  const { show: toast } = useToast()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('find_duplicate_groups')
    if (error) toast(error.message, 'error')
    setGroups((data as Group[]) ?? [])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // On garde le plus ancien (ids est trié par created_at) et on envoie les
  // autres à la corbeille: rien n'est détruit, la purge a 30 jours pour
  // laisser le temps de revenir en arrière.
  const cleanGroup = async (g: Group) => {
    setBusy(g.content_hash)
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
          </div>

          <ul className="space-y-2">
            {groups.map((g) => {
              // Plusieurs lignes sur le MÊME objet R2 ne coûtent rien de plus:
              // le dire évite de faire supprimer pour rien.
              const sameObject = g.distinct_objects === 1
              return (
                <li key={g.content_hash} className="glass rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {g.kind === 'video' ? '🎬' : g.kind === 'photo' ? '🖼️' : '📄'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{g.sample_name}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {g.copies} {t('dup.copies')} ·{' '}
                        {formatBytes(Number(g.size_bytes))}
                        {sameObject
                          ? ` · ${t('dup.sameObject')}`
                          : ` · ${formatBytes(Number(g.wasted_bytes))} ${t('dup.wasted')}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => cleanGroup(g)}
                      disabled={busy === g.content_hash}
                      className="shrink-0 px-3 py-2 text-xs"
                    >
                      {busy === g.content_hash ? (
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
