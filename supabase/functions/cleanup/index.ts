// Edge Function: cleanup
// Suppression DÉFINITIVE demandée par l'utilisateur depuis la Corbeille.
// Hard-delete des lignes files (les siennes, déjà en corbeille), puis GC R2
// des objets devenus orphelins (comptage de références).
import { r2Client } from '../_shared/r2.ts'
import { requireUser, serviceClient } from '../_shared/auth.ts'
import { gcOrphans } from '../_shared/gc.ts'
import { json, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  try {
    const user = await requireUser(req)
    if (!user) return json({ error: 'non authentifié' }, 401)

    const { file_ids } = await req.json()
    if (!Array.isArray(file_ids) || file_ids.length === 0)
      return json({ error: 'file_ids requis' }, 400)

    const service = serviceClient()

    // On ne supprime QUE des fichiers de l'utilisateur, déjà en corbeille.
    const { data: rows, error: selErr } = await service
      .from('files')
      .select('id, r2_key, thumb_key')
      .in('id', file_ids)
      .eq('owner_id', user.id)
      .not('deleted_at', 'is', null)
    if (selErr) throw selErr
    if (!rows || rows.length === 0) return json({ deleted: [], kept: [] })

    const ids = rows.map((r) => r.id)
    const keys = [
      ...rows.map((r) => r.r2_key),
      ...rows.map((r) => r.thumb_key).filter(Boolean),
    ] as string[]

    // 1) Hard-delete des lignes AVANT le comptage (sinon elles se comptent elles-mêmes).
    const { error: delErr } = await service.from('files').delete().in('id', ids)
    if (delErr) throw delErr

    // 2) GC R2 des objets désormais orphelins.
    const result = await gcOrphans(service, r2Client(), keys)
    return json(result)
  } catch (e) {
    console.error('cleanup', e)
    return json({ error: String(e) }, 500)
  }
})
