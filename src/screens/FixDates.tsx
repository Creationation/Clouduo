import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { dateFromName } from '../lib/media'
import { updateFileInfo } from '../lib/files'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Button, EmptyState, Spinner } from '../components/ui'

interface Fix {
  id: string
  name: string
  was: string | null
  becomes: string
}

// Sous cet écart, la date enregistrée est déjà la bonne: inutile de la
// réécrire pour quelques minutes.
const TOLERANCE_MS = 60 * 60 * 1000

/**
 * Rattrapage des dates déjà enregistrées.
 *
 * Les envois d'aujourd'hui lisent la date dans le nom du fichier quand
 * l'appareil n'en a pas laissé (voir media.ts). Les fichiers envoyés AVANT
 * cette correction gardent, eux, la date de leur copie sur le téléphone:
 * c'est ce qui séparait des photos de la même soirée sur deux jours.
 *
 * Deux précautions, parce qu'on touche à des données existantes:
 *  - on ne propose que les fichiers dont le nom porte une date, et seulement
 *    si elle s'écarte de plus d'une heure de celle enregistrée;
 *  - rien n'est écrit avant d'avoir montré ce qui va changer.
 * Une date reste modifiable fichier par fichier de toute façon.
 */
export default function FixDates() {
  const { t, lang } = useI18n()
  const { show: toast } = useToast()
  const [scanning, setScanning] = useState(false)
  const [fixes, setFixes] = useState<Fix[] | null>(null)
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(
    null,
  )

  const locale = lang === 'de' ? 'de-AT' : 'fr-FR'
  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '·'

  const scan = async () => {
    setScanning(true)
    try {
      const { data: auth } = await supabase.auth.getUser()
      // Mes fichiers uniquement: on ne réécrit pas les dates de l'autre.
      const { data, error } = await supabase
        .from('files')
        .select('id, name, taken_at')
        .eq('owner_id', auth.user!.id)
        .is('deleted_at', null)
      if (error) throw error

      const found: Fix[] = []
      for (const f of (data ?? []) as {
        id: string
        name: string
        taken_at: string | null
      }[]) {
        const named = dateFromName(f.name)
        if (!named) continue
        const current = f.taken_at ? new Date(f.taken_at).getTime() : null
        if (current !== null && Math.abs(current - named.getTime()) < TOLERANCE_MS)
          continue
        found.push({
          id: f.id,
          name: f.name,
          was: f.taken_at,
          becomes: named.toISOString(),
        })
      }
      found.sort((a, b) => a.becomes.localeCompare(b.becomes))
      setFixes(found)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setScanning(false)
    }
  }

  const apply = async () => {
    if (!fixes?.length) return
    setApplying({ done: 0, total: fixes.length })
    let ok = 0
    for (const f of fixes) {
      try {
        await updateFileInfo(f.id, { taken_at: f.becomes })
        ok += 1
      } catch {
        /* un fichier retiré entre temps ne doit pas arrêter le rattrapage */
      }
      setApplying((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    setApplying(null)
    setFixes([])
    toast(`${ok} ${t('dates.done')}`, 'success')
  }

  return (
    <div className="safe-top mx-auto max-w-2xl p-4">
      <h1 className="mb-1 text-xl font-semibold">{t('dates.title')}</h1>
      <p className="mb-5 text-sm text-[var(--color-muted)]">{t('dates.intro')}</p>

      {fixes === null ? (
        <Button onClick={scan} disabled={scanning} className="w-full py-2.5">
          {scanning ? t('dates.scanning') : t('dates.scan')}
        </Button>
      ) : fixes.length === 0 ? (
        <EmptyState>{t('dates.none')}</EmptyState>
      ) : (
        <>
          <div className="glass mb-4 rounded-2xl p-4">
            <div className="flex items-center justify-between text-sm">
              <span>{t('dates.found')}</span>
              <span className="font-semibold">{fixes.length}</span>
            </div>
            <Button
              onClick={apply}
              disabled={!!applying}
              className="mt-3 w-full py-2 text-sm"
            >
              {applying
                ? `${applying.done}/${applying.total}`
                : t('dates.apply')}
            </Button>
          </div>

          {/* Ce qui va changer, avant d'écrire quoi que ce soit. */}
          <ul className="space-y-2">
            {fixes.slice(0, 50).map((f) => (
              <li key={f.id} className="glass rounded-xl p-3 text-sm">
                <p className="truncate">{f.name}</p>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {t('dates.was')} {fmt(f.was)} · {t('dates.willBe')}{' '}
                  <strong className="text-[var(--color-success)]">
                    {fmt(f.becomes)}
                  </strong>
                </p>
              </li>
            ))}
          </ul>
          {fixes.length > 50 && (
            <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
              +{fixes.length - 50} {t('dates.more')}
            </p>
          )}
        </>
      )}

      {scanning && (
        <div className="mt-6 flex justify-center text-[var(--color-muted)]">
          <Spinner />
        </div>
      )}
    </div>
  )
}
