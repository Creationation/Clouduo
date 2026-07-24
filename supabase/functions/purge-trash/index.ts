// Edge Function: purge-trash (déclenchée par cron)
// Supprime définitivement les fichiers en corbeille depuis > 30 jours,
// puis GC R2 des objets orphelins. Protégée par un secret d'en-tête.
//
// Planifier via pg_cron + pg_net (voir README) pour un appel quotidien.
import { r2Client } from '../_shared/r2.ts'
import { serviceClient } from '../_shared/auth.ts'
import { gcOrphans } from '../_shared/gc.ts'
import { json, preflight } from '../_shared/cors.ts'

const RETENTION_DAYS = 30

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  try {
    // Auth par secret partagé (le cron l'envoie dans l'en-tête).
    const secret = req.headers.get('x-cron-secret')
    if (!secret || secret !== Deno.env.get('CRON_SECRET'))
      return json({ error: 'interdit' }, 403)

    const service = serviceClient()
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString()

    const { data: rows, error: selErr } = await service
      .from('files')
      .select('id, r2_key, thumb_key')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
    if (selErr) throw selErr
    if (!rows || rows.length === 0) return json({ purged: 0, deleted: [], kept: [] })

    const ids = rows.map((r) => r.id)
    const keys = [
      ...rows.map((r) => r.r2_key),
      ...rows.map((r) => r.thumb_key).filter(Boolean),
    ] as string[]

    const { error: delErr } = await service.from('files').delete().in('id', ids)
    if (delErr) throw delErr

    const result = await gcOrphans(service, r2Client(), keys)
    return json({ purged: ids.length, ...result })
  } catch (e) {
    console.error('purge-trash', e)
    return json({ error: String(e) }, 500)
  }
})
