// Edge Function: sign-upload
// Signe les URL d'upload direct navigateur -> R2. Le fichier ne transite
// par aucun serveur. Deux flux:
//   - action 'put'               : petit fichier, un seul PUT signé (+ miniature)
//   - action 'multipart-*'       : gros fichier (vidéos), upload en plusieurs parts
import {
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from 'npm:@aws-sdk/client-s3@^3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@^3'
import { r2Client, bucket, safeName } from '../_shared/r2.ts'
import { requireUser } from '../_shared/auth.ts'
import { corsHeaders, json, preflight } from '../_shared/cors.ts'

const EXPIRES = 3600 // 1h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  try {
    const user = await requireUser(req)
    if (!user) return json({ error: 'non authentifié' }, 401)

    const body = await req.json()
    const action: string = body.action ?? 'put'
    const s3 = r2Client()
    const B = bucket()

    switch (action) {
      // -------- Petit fichier: PUT unique original + PUT miniature --------
      case 'put': {
        const { name, mime, uuid, withThumb } = body
        if (!name || !mime || !uuid) return json({ error: 'params manquants' }, 400)
        const r2_key = `originals/${user.id}/${uuid}/${safeName(name)}`
        const thumb_key = withThumb ? `thumbs/${user.id}/${uuid}.webp` : null

        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: B, Key: r2_key, ContentType: mime }),
          { expiresIn: EXPIRES },
        )
        let thumbUploadUrl: string | null = null
        if (thumb_key) {
          thumbUploadUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({ Bucket: B, Key: thumb_key, ContentType: 'image/webp' }),
            { expiresIn: EXPIRES },
          )
        }
        return json({ r2_key, thumb_key, uploadUrl, thumbUploadUrl })
      }

      // -------- Multipart: création de la session --------
      case 'multipart-create': {
        const { name, mime, uuid, withThumb } = body
        if (!name || !mime || !uuid) return json({ error: 'params manquants' }, 400)
        const r2_key = `originals/${user.id}/${uuid}/${safeName(name)}`
        const thumb_key = withThumb ? `thumbs/${user.id}/${uuid}.webp` : null
        const out = await s3.send(
          new CreateMultipartUploadCommand({ Bucket: B, Key: r2_key, ContentType: mime }),
        )
        let thumbUploadUrl: string | null = null
        if (thumb_key) {
          thumbUploadUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({ Bucket: B, Key: thumb_key, ContentType: 'image/webp' }),
            { expiresIn: EXPIRES },
          )
        }
        return json({ r2_key, thumb_key, uploadId: out.UploadId, thumbUploadUrl })
      }

      // -------- Multipart: signer un lot de parts --------
      case 'multipart-sign': {
        const { r2_key, uploadId, partNumbers } = body
        if (!r2_key || !uploadId || !Array.isArray(partNumbers))
          return json({ error: 'params manquants' }, 400)
        // Sécurité: on ne signe que des clés du propriétaire.
        if (!String(r2_key).startsWith(`originals/${user.id}/`))
          return json({ error: 'clé interdite' }, 403)
        const urls = await Promise.all(
          partNumbers.map(async (partNumber: number) => ({
            partNumber,
            url: await getSignedUrl(
              s3,
              new UploadPartCommand({
                Bucket: B,
                Key: r2_key,
                UploadId: uploadId,
                PartNumber: partNumber,
              }),
              { expiresIn: EXPIRES },
            ),
          })),
        )
        return json({ urls })
      }

      // -------- Multipart: finaliser --------
      case 'multipart-complete': {
        const { r2_key, uploadId, parts } = body
        if (!r2_key || !uploadId || !Array.isArray(parts))
          return json({ error: 'params manquants' }, 400)
        if (!String(r2_key).startsWith(`originals/${user.id}/`))
          return json({ error: 'clé interdite' }, 403)
        // parts: [{ PartNumber, ETag }], triés par PartNumber
        const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: B,
            Key: r2_key,
            UploadId: uploadId,
            MultipartUpload: { Parts: sorted },
          }),
        )
        return json({ ok: true })
      }

      // -------- Multipart: annuler (reprise impossible / abandon) --------
      case 'multipart-abort': {
        const { r2_key, uploadId } = body
        if (!r2_key || !uploadId) return json({ error: 'params manquants' }, 400)
        if (!String(r2_key).startsWith(`originals/${user.id}/`))
          return json({ error: 'clé interdite' }, 403)
        await s3.send(
          new AbortMultipartUploadCommand({ Bucket: B, Key: r2_key, UploadId: uploadId }),
        )
        return json({ ok: true })
      }

      default:
        return json({ error: `action inconnue: ${action}` }, 400)
    }
  } catch (e) {
    console.error('sign-upload', e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
