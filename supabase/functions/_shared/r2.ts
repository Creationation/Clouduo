import { S3Client } from 'npm:@aws-sdk/client-s3@^3'

// Client S3 configuré pour Cloudflare R2.
// Les secrets sont injectés via `supabase secrets set` (jamais côté client).
export function r2Client(): S3Client {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')!
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    },
    forcePathStyle: true,
  })
}

export function bucket(): string {
  return Deno.env.get('R2_BUCKET')!
}

// Nettoie un nom de fichier pour l'utiliser dans une clé R2.
export function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 180) || 'fichier'
}
