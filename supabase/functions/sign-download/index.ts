// Edge Function: sign-download
// Retourne des URL GET signées (1h) pour visionneuse, streaming vidéo
// (R2 gère les range requests nativement) et téléchargement.
// Deux modes:
//   - { key }            -> { url }         (un objet, option download/filename)
//   - { keys: string[] } -> { urls: {..} }  (lot: miniatures de la galerie)
// L'accès est validé via RLS: on ne signe que les clés que l'utilisateur
// a le droit de voir (r2_key ou thumb_key d'une ligne files visible).
import { GetObjectCommand } from 'npm:@aws-sdk/client-s3@^3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@^3'
import { r2Client, bucket } from '../_shared/r2.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'

const EXPIRES = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  try {
    const user = await requireUser(req)
    if (!user) return json({ error: 'non authentifié' }, 401)

    const s3 = r2Client()
    const B = bucket()
    const supa = userClient(req)
    const bodyIn = await req.json()

    // ---------- Mode lot ----------
    if (Array.isArray(bodyIn.keys)) {
      const requested: string[] = bodyIn.keys.filter(Boolean)
      if (requested.length === 0) return json({ urls: {} })
      // Clés réellement autorisées (RLS s'applique à cette requête).
      const { data, error } = await supa
        .from('files')
        .select('r2_key, thumb_key')
        .or(
          `r2_key.in.(${requested.join(',')}),thumb_key.in.(${requested.join(',')})`,
        )
      if (error) throw error
      const allowed = new Set<string>()
      for (const row of data ?? []) {
        if (row.r2_key) allowed.add(row.r2_key)
        if (row.thumb_key) allowed.add(row.thumb_key)
      }
      const urls: Record<string, string> = {}
      await Promise.all(
        requested
          .filter((k) => allowed.has(k))
          .map(async (k) => {
            urls[k] = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: B, Key: k }),
              { expiresIn: EXPIRES },
            )
          }),
      )
      return json({ urls })
    }

    // ---------- Mode unitaire ----------
    const { key, download, filename } = bodyIn
    if (!key) return json({ error: 'clé manquante' }, 400)
    const { data, error } = await supa
      .from('files')
      .select('id')
      .or(`r2_key.eq.${key},thumb_key.eq.${key}`)
      .limit(1)
    if (error) throw error
    if (!data || data.length === 0) return json({ error: 'accès refusé' }, 403)

    const cmd = new GetObjectCommand({
      Bucket: B,
      Key: key,
      ...(download
        ? {
            ResponseContentDisposition: `attachment; filename="${
              (filename ?? 'fichier').replace(/"/g, '')
            }"`,
          }
        : {}),
    })
    const url = await getSignedUrl(s3, cmd, { expiresIn: EXPIRES })
    return json({ url })
  } catch (e) {
    console.error('sign-download', e)
    return json({ error: String(e) }, 500)
  }
})
