import { DeleteObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@^3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2'
import { bucket } from './r2.ts'

// Supprime d'R2 les objets qui ne sont PLUS référencés par AUCUNE ligne files
// (ni active, ni en corbeille). C'est la règle absolue du cahier des charges:
// on ne perd jamais un objet encore référencé ailleurs (Commun, copie, transfert).
export async function gcOrphans(
  service: SupabaseClient,
  s3: S3Client,
  keys: string[],
): Promise<{ deleted: string[]; kept: string[] }> {
  const B = bucket()
  const deleted: string[] = []
  const kept: string[] = []
  const uniqueKeys = [...new Set(keys.filter(Boolean))]

  for (const key of uniqueKeys) {
    // Comptage sur r2_key ET thumb_key: une clé de miniature peut aussi être partagée.
    const { count, error } = await service
      .from('files')
      .select('id', { count: 'exact', head: true })
      .or(`r2_key.eq.${key},thumb_key.eq.${key}`)
    if (error) throw error

    if ((count ?? 0) === 0) {
      await s3.send(new DeleteObjectCommand({ Bucket: B, Key: key }))
      deleted.push(key)
    } else {
      kept.push(key)
    }
  }
  return { deleted, kept }
}
