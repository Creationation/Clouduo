import { supabase } from './supabase'

/**
 * Plafond de stockage. R2 ne facture pas au forfait: rien ne bloque
 * techniquement, la limite est un choix de budget. On la déclare ici pour
 * pouvoir prévenir AVANT de lancer un envoi, plutôt que de laisser gonfler la
 * facture en silence.
 *
 * Le calcul se base sur `physical_total`, qui compte les objets R2 distincts:
 * un fichier référencé plusieurs fois (récupéré du Commun, transfert accepté)
 * n'occupe l'espace qu'une seule fois.
 */
export const STORAGE_QUOTA_BYTES = 100 * 1024 ** 3 // 100 Go
export const WARN_RATIO = 0.9

interface Bucket {
  bytes: number
  count: number
}

export async function usedBytes(): Promise<number> {
  const { data, error } = await supabase.rpc('get_storage_stats')
  if (error) throw error
  const stats = data as { physical_total?: Bucket } | null
  return stats?.physical_total?.bytes ?? 0
}

export interface QuotaCheck {
  used: number
  incoming: number
  quota: number
  /** L'envoi ferait dépasser le plafond: à refuser. */
  full: boolean
  /** On approche du plafond: à signaler sans bloquer. */
  near: boolean
}

export async function checkQuota(incoming: number): Promise<QuotaCheck> {
  const used = await usedBytes()
  const after = used + incoming
  return {
    used,
    incoming,
    quota: STORAGE_QUOTA_BYTES,
    full: after > STORAGE_QUOTA_BYTES,
    near: after > STORAGE_QUOTA_BYTES * WARN_RATIO,
  }
}
